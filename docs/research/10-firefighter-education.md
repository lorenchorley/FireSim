# 10 — Firefighter education and safety content (beginner bush firefighters, NSW mountain country)

Status: research note for FireSim's teaching layer: insight cards, safety overlays and scenario design.
Scope:
- NSW RFS training context;
- LACES, the 10 Standard Fire Orders and the 18 Watch Out situations;
- the dead-man zone and wind changes;
- how topography shapes entrapments, with Australian and US burnover case studies;
- indicators of erratic fire behaviour in mountains (smoke, column, crowning, spotting, whirls, pyroCb);
- safe work practices in steep terrain;
- back-burning principles and risks in mountains;
- how fire behaviour changes through the day in mountains;
- the evidence on how fire-behaviour intuition is taught (sand tables, staff rides, simulation).

It ends with a library of 40 insight cards.

Companion documents: `02-mountain-meteorology.md` covers VLS, lee separation, C-Haines, PFT, katabatic and anabatic flow and thermal belts in depth. This document cross-references it and does not duplicate that physics. Card IDs here use the prefix **S** (safety/education) so they cannot collide with the meteorology cards in doc 02.

> **Safety framing (non-negotiable).** FireSim is an education tool.
> - It must never be presented as an operational prediction system.
> - On an active fireground, a beginner's job is situational awareness and following their Crew Leader. It is not reading a phone.
> - On-site use should happen at staging areas, during briefings, in safe refuges, in after-action reviews, or run by an instructor or Crew Leader.
> - Every card ends with doctrine, not with the model: "LACES first; follow your Crew Leader and NSW RFS SOPs".

---

## 0. Provenance, confidence tags and research limitations

**Research limitations (read first).** In this session:
- the sandbox's egress proxy blocked every WebFetch I attempted, including afac.com.au, rfs.nsw.gov.au, publish.csiro.au, research.fs.usda.gov, ffm.vic.gov.au, knowledge.aidr.org.au, nwcg.gov, wikipedia.org, semanticscholar.org, abc.net.au and a wordpress-hosted copy of the dead-man-zone paper;
- the shared web-search budget ran out after six queries.

So only a handful of claims could be confirmed from search-result text this session. Everything else comes from my knowledge of the literature. I have tried hard not to invent numbers: where I am unsure of a value I say so and I do not supply one.

Tags (the same scheme as doc 02):

- **[V]**: confirmed in this session from search-result text quoting the cited source, or a reputable secondary summary of it (secondary summaries are marked).
- **[L]**: established literature item that could not be re-read here. The citation is believed correct. **Check the number against the primary source before hard-coding it or showing it in-app.**
- **[D]**: derived here from first principles or simple geometry; the working is shown.
- **[H]**: FireSim design heuristic. It is not a published threshold, so it must be tunable and reviewed by NSW RFS instructors.

A verification checklist for all [L] numbers that end up in shipped card text is in §11.

**Adversarial fact-check pass (2026-09-27).** A second reviewer re-checked every equation, threshold and case-study fact against the primary documents that could be reached. Most publisher sites (CSIRO Publishing, T&F, RFS, AFAC, Wikipedia, USFS, ABC) were still blocked by the egress proxy and the web-search budget was exhausted. These primary documents were downloaded and read in full or in the relevant sections:
- NWCG *Incident Response Pocket Guide*, PMS 461, **January 2025** edition (NWCG S3 bucket);
- NWCG *10 Standard Firefighting Orders & 18 Watch Out Situations* poster, PMS 110-18 (05/20);
- Gleason P (June 1991) *LCES and Other Thoughts* (NWCG S3 bucket);
- SA Deputy State Coroner (Schapel) *Wangary inquest findings summary*;
- Matthews S (2022) *AFDRS Fire Behaviour Index Technical Guide* v1.0 (FBI-TG);
- Matthews et al. (2019) *AFDRS Research Prototype* report (AFDRS-RP), chapter 2 (suppression-threshold tables);
- USFS Missoula Fire Lab `behave` source, `safeSeparationDistanceCalculator.cpp` (the SSD Δ lookup table);
- Australian Prime Minister's media statement of 31 Dec 2019 and the parliamentary condolence motion of Feb 2020 (PM Transcripts archive, via GitHub mirror).

Items checked in this pass carry **"(verified: source)"**. Items that could not be checked carry **"(UNVERIFIED — reason)"**. Items cross-checked against a companion doc that verified them (01, 02, 03, 06) say so. Corrections made in this pass are summarised in §11.1.

---

## 1. Executive summary: what matters most for this app

1. **Most Australian firefighter burnovers are wind-change / flank events, not head-fire events.** A fire's long flank becomes a wide head fire the moment the wind swings. Examples:
   - **Linton, Vic, 2 December 1998:** five CFA firefighters died when "a south-westerly wind change turned an uncontrolled part of the east flank into the head of the fire" [V]; the crew "never received a vital message about when the wind change was due" [V].
   - **Upper Beaconsfield, Ash Wednesday, 16 Feb 1983:** twelve volunteer firefighters were trapped and killed when the wind change struck (secondary: archived Wikipedia text; UNVERIFIED against the coronial record).
   - **Black Saturday 2009:** the SW change between about 17:30 and 18:30 turned the roughly 55 km long eastern flank of the Kilmore East fire into a head fire (cross-checked: doc 02, verified there from Cruz et al. 2012).
   - **Wangary, SA, 11 Jan 2005:** a fire declared "contained" (20:54 on 10 Jan) and "controlled" (07:45 on 11 Jan) was still burning in a paperbark swamp and sugar gums. It broke out from about 09:50 under a strong NW wind. Two farm firefighters died on Settlers Road shortly after the wind there changed to westerly at about 11:30 (verified: SA Coroner findings summary). The quote "when the wind changed … a wide front opened up" is from the ABC 2025 retrospective (secondary [V] from the first pass).

   FireSim's most important safety feature is therefore a **wind-change and dead-man-zone (DMZ) overlay**, not the head-fire ROS number.

2. **The dead-man zone** (Cheney, Gould & McCaw 2001, *Australian Forestry* 64:45–50) [V] is the ground that would burn within about **5 minutes** under the current wind *or an anticipated change*. It ranges from **under 100 m to well over 1 km** (secondary summary [V]).
   - A flank that turns into a head "moves out at its maximum rate of spread almost immediately", because it is already wide and does not need to accelerate the way a point ignition does (secondary summary [V]; the physics is in Cheney & Gould 1995 [L]).
   - The app can compute the DMZ directly from its spread model (§9.3).

3. **Topography is the multiplier beginners underestimate most.**
   - Rule of thumb: rate of spread roughly doubles for every 10° of upslope, `R_θ = R_0·exp(0.069 θ)` (McArthur 1967; Noble et al. 1980). (cross-checked: doc 01, verified there against the fiRetools code transcription of Noble et al. 1980.)
   - Its nominal domain is −40° to +40°. However, Cheney (1981) cautioned it may not hold beyond 30°, and laboratory comparisons show all operational models *under-predict* above about 20° (cross-checked: doc 01, citing the Cruz, Sullivan & Alexander 2014 review and a 2026 184-fire comparison). *Correction: the first draft said "only tested to about 20°", which overstated the limit.*
   - Downslope, the symmetric `exp(−0.069θ)` form under-predicts backing spread. The CSIRO "kataburn" correction (Sullivan et al. 2014) never falls below 0.5 × flat-ground ROS (cross-checked: doc 01).
   - Above about 24° flames can **attach to the slope** (Wu, Xing & Atkinson 2000; cross-checked: doc 01) and produce **eruptive** fire, particularly in gullies and canyons (Viegas & Pita 2004; Viegas 2005; Dold & Zinoviev 2009). The US IRPG independently lists "steep slopes (>45%)", about 24°, as a topographic danger indicator (verified: IRPG PMS 461, Jan 2025, p. 35).
   - Fires below you on a slope, in chimneys and gullies, and near saddles or mid-slope roads are the classic entrapment settings: Mann Gulch 1949, South Canyon 1994, Yarnell Hill 2013 [L]. Of US burnover fatalities from 1990 to 2017, **76% occurred in mountainous terrain** (cross-checked: doc 01, verified from USFS RMRS-P-78).
   - The current IRPG lists **five** "common denominators" of tragedy fires, including "when fire responds to topographic conditions and runs uphill" and "during critical burn period between 1400 and 1700" (verified: IRPG 2025 p. 3).

4. **You cannot outrun a fire uphill.** Tobler's hiking function gives about 1.4 km/h on a 20° track. A moderate dry-forest fire on the same slope can exceed 2–3 km/h under McArthur Mk5 [D, §4.8], and Mk5 tends to *under*-predict [L].
   - Escape routes should therefore run **downhill, sideways, or into the black**, never uphill ahead of a fire.
   - NSW RFS / AFAC doctrine requires an escape route usable "at a jogging pace" and a safety refuge within 100 m of where firefighters work if only one escape route exists [V, first pass, from search-result text of the NSW RFS Prescribed Burning protocol; not re-read in the second pass].
   - The US IRPG says to "avoid steep, uphill escape routes" and to time routes "considering slowest person, fatigue, and temperature factors" (verified: IRPG 2025 p. 5).

5. **Safety refuge size.** The Australian doctrine is clearance of at least **4× predicted flame height** in the direction of the approaching fire [V, first pass]. This matches Butler & Cohen (1998) and the current US IRPG, which specifies "at least four times the maximum continuous flame height", calculated from "radiant heat only", for "flat terrain and no wind" (verified: IRPG 2025 p. 6).
   - The IRPG warns that "safety zone size will increase (possibly by more than double) as wind exceeds 10 mph [16 km/h] and/or slope exceeds 20% [≈11°]" (verified: IRPG 2025 p. 5).
   - Page & Butler (2017) proposed an empirical **safe separation distance** `SSD = 8 × vegetation height × Δ`. Δ is a lookup on wind class × burning condition × slope class, running from 1 to 10 (verified: USFS Fire Lab `behave` source; see §4.7).
   - *Correction:* the first draft said SSD should be copied from the "current IRPG". The January 2025 IRPG does **not** print the SSD table; it prints only the 4× rule (checked this pass).
   - FireSim should show both, and should flag refuges on slopes or in wind as "check size".

6. **Mountain-specific dynamic behaviours that fool beginners:**
   - lee-slope eddies and VLS "fire channelling" (doc 02);
   - fire running *downhill* in strong winds;
   - spotting across ridges into the next valley;
   - junction zones where a backburn meets the main fire at an acute angle, with geometric speed-up `1/sin(α/2)` [D] plus physical interaction [L];
   - morning inversion break-up;
   - night-time thermal-belt and ridge-top activity;
   - plume-dominated fires, column collapse and pyroCb.

   Nine firefighters died in the 2019–20 "Black Summer" (verified: parliamentary condolence motion, Feb 2020). Their names and the known causes:
   - David Moresi, East Gippsland (Vic): vehicle rollover.
   - Geoffrey Keaton and Andrew O'Dwyer, Horsley Park brigade, NSW RFS: Green Wattle Creek fire. A tree struck their tanker, which left the road (verified that they died on that fire; the mechanism is cross-checked from doc 01 and secondary sources, and the coronial findings were not retrieved).
   - Samuel McPaul, Morven brigade, NSW RFS: near Jingellic on 30 Dec 2019, when extreme wind overturned his truck. Two crewmates were burned (verified: PM statement 31 Dec 2019 and news reports). Whether the wind was a fire-generated vortex/"fire tornado" or a pyroCb downdraft is UNVERIFIED (coronial findings not retrieved).
   - Bill Slade (NSW) and Mat Kavanagh (Vic): causes not verified here.
   - Captain Ian McBeth, First Officer Paul Hudson and Flight Engineer Rick DeMorgan Jr, US aircrew: their C-130 air tanker crashed near Peak View in the NSW Snowy Monaro on 23 Jan 2020 (verified: condolence motion).

   Hazard trees, vehicle travel in fire areas, and extreme pyroconvective winds therefore belong in the curriculum alongside burnovers. A near miss adds crew protection: on 21 Dec 2019 a Blue Mountains (Blackheath-area) tanker was overrun after running out of water, "meaning it couldn't activate the sprinkler system" (verified: condolence motion). Keeping a crew-protection water reserve is therefore a card (S41).

7. **How intuition is taught.**
   - Expert fireground decisions are recognition-primed (Klein et al. 1986) [L]. Intuition is built by many cheap "predict, then see what happens" cycles in realistic settings: sand tables, tactical decision games, staff rides and simulations.
   - FireSim's comparative advantage is a **predict–observe–explain (POE)** loop on the trainee's *actual* terrain, with a ranked "why" breakdown.
   - Direct evidence on wildland-fire training outcomes is thin, so the design leans on transferable evidence from dynamic-decision-making and simulation-education research (Brehmer 1992; Cook et al. 2011) [L].

8. **Explain through factor attribution.** Show the top three multiplicative contributors to the current behaviour (slope, wind, fuel moisture, fuel load/structure, alignment, pyroconvection) as plain-language "because" statements, each with a confidence level.

---

## 2. Training and doctrine context

### 2.1 NSW RFS training pathway (context for card wording)

- **Bush Firefighter (BF)** is the NSW RFS entry-level operational qualification for bush and grass firefighting [L]. It covers:
  - fire behaviour basics (fuel, weather, topography);
  - personal protective clothing;
  - hoses, pumps and tanker work;
  - radio communications;
  - LACES;
  - burnover and crew-protection drills;
  - fireground hazards.
- **Village Firefighter (VF)** adds structural and village-interface skills [L].
- **Advanced Firefighter (AF)** adds more fire behaviour, navigation and map reading, and suppression tactics [L].
- These lead to **Crew Leader Wildfire** and higher roles [L].
- Units align with the national PUA Public Safety training package, e.g. "Respond to wildfire" and "Suppress wildfire" [L]. Unit codes change with package revisions, so do not hard-code them.
- **Implication for cards:** write for BF level (no jargon without a gloss). Tag AF-level concepts such as ROS, fireline intensity and backburn lighting patterns as "advanced".

NSW RFS publishes "foundational doctrine" documents including:
- *Bush and Forest Fires*;
- *Grass and Crop Fires*;
- *Safety Refuges from Bush and Grass Fires*;
- *Fundamental Protocols* (e.g. Fundamental Protocol 2);
- a *Prescribed Burning Activities General Operational Protocol*.

Their existence and URLs were confirmed [V], but not their full contents. The in-app wording of safety rules must be reconciled with these documents by an RFS instructor before release (§11).

Incident management context: AIIMS (Australasian Inter-service Incident Management System, AFAC) [L]. Card language such as "tell your Crew Leader" is consistent with AIIMS span-of-control and chain-of-command.

### 2.2 LACES (Australian adaptation of LCES)

AFAC doctrine "Use of Lookouts, Awareness, Communications, Escape Routes, Safety Zones (LACES) system for safety on the fireground" is "implemented in all Australian and New Zealand fire services" [V]. The NSW RFS Prescribed Burning protocol text [V]:

- **Lookouts**: "Everyone looks out for everybody else. A lookout is to be posted to warn firefighters of any approaching fire or spot fire."
- **Awareness**: "Everybody is aware of current and anticipated behaviour of the fire and other incident hazards and precautions."
- **Communications**: "Everybody listens and voices any concerns about what is happening at the incident."
- **Escape routes**: "The escape route shall be such that a firefighter could move along it on foot to the safety refuge at a jogging pace, if needed."
- **Safety refuges**: "an area clear of any significant combustibles to a horizontal distance (in the direction of an approaching fire) of at least four times the predicted flame height. A safety refuge is to be available within 100 metres of where any firefighter is working, if only one escape route to a safety refuge is available."
- "The LACES safety checklist system is to be applied to all prescribed burning activities."

The US origin, LCES, was developed by Paul Gleason, former Zig Zag Hotshot Superintendent, in June 1991 (verified: Gleason 1991, read this pass). The Australian version adds **A**wareness. Points from the original worth carrying into cards (verified: Gleason 1991):
- The wildland fire environment has "four basic objective hazards: lightning, fire-weakened timber (standing and lying), rolling rocks and entrapment by running fires".
- LCES is a *system*: "the best safety zone is of no value if your escape route does not offer you timely access when needed".
- Lookouts "need to be in a position where both the objective hazard and the firefighter(s) can be seen". Because of terrain, cover and fire size, "one lookout is normally not sufficient". This directly supports the viewshed feature and card S37.
- The current IRPG adds that LCES "must be established and known to ALL firefighters BEFORE it is needed", and that lookouts need "knowledge of trigger points" (verified: IRPG 2025 p. 5).

**What FireSim can do for each element [H]:**

| Element | App support |
|---|---|
| L | Viewshed from a user-placed lookout: which parts of the fire and which crew positions are visible. Covers Watch Out #12. |
| A | The simulation itself, the "why" panel and wind-change countdowns. |
| C | Out of scope technically. A "who needs to know" prompt appears when the wind-change card fires, echoing Linton [V]. |
| E | Escape-time computation on the DEM (Tobler), comparing time-to-refuge against time-for-fire-to-arrive. |
| S | Refuge-size check (4× flame height doctrine; SSD comparison), plus refuge placement red flags (saddle, chimney, mid-slope, below fuel). |

### 2.3 The 10 Standard Firefighting Orders and 18 Watch Out Situations (US, NWCG)

The 10 Standard Orders originate from a 1957 US Forest Service task force (NWCG page "Origin of the 10 and 18 – June 17, 1957", existence [V] in the first pass). The Watch Out list is usually described as following soon after: originally 13 situations, later expanded to 18 (UNVERIFIED — the NWCG history page could not be read). Current publications are NWCG PMS 110, PMS 118 and the combined poster PMS 110-18 (05/20). The Incident Response Pocket Guide PMS 461 is currently the January 2025 edition (verified: both documents downloaded this pass). They are widely taught in Australia as supplements to LACES.

**10 Standard Firefighting Orders** (verified: PMS 110-18 (05/20), verbatim):
1. Keep informed on fire weather conditions and forecasts.
2. Know what your fire is doing at all times.
3. Base all actions on current and expected behavior of the fire.
4. Identify escape routes and safety zones, and make them known.
5. Post lookouts when there is possible danger.
6. Be alert. Keep calm. Think clearly. Act decisively.
7. Maintain prompt communications with your forces, your supervisor, and adjoining forces.
8. Give clear instructions and be sure they are understood. *(The first draft read "ensure they are understood". Corrected.)*
9. Maintain control of your forces at all times.
10. Fight fire aggressively, having provided for safety first.

**18 Watch Out Situations** (verified wording: PMS 110-18 (05/20)), with FireSim auto-detectability [H]:

| # | Watch Out | FireSim detection |
|---|---|---|
| 1 | Fire not scouted and sized up | Scenario flag if no fire perimeter has been marked |
| 2 | In country not seen in daylight | Night + crew in unvisited area (user flag) |
| 3 | Safety zones and escape routes not identified | No refuge / escape route drawn → persistent banner |
| 4 | Unfamiliar with weather and local factors influencing fire behavior | Prompt the weather/terrain briefing card set |
| 5 | Uninformed on strategy, tactics, and hazards | Not detectable |
| 6 | Instructions and assignments not clear | Not detectable |
| 7 | No communication link with crewmembers or supervisor | Not detectable (user flag) |
| 8 | Constructing line without safe anchor point | Control line drawn not connected to non-fuel/black → S26 |
| 9 | Building fireline downhill with fire below | Crew above active edge on slope → S06 |
| 10 | Attempting frontal assault on fire | Crew in front of head (within DMZ, head-facing) → S12 |
| 11 | Unburned fuel between you and fire | Crew separated from fire edge by unburnt fuel → S21 |
| 12 | Cannot see main fire, not in contact with someone who can | Viewshed from crew/lookout excludes head → S37 |
| 13 | On a hillside where rolling material can ignite fuel below | Burning cells above unburnt fuel on slope ≥ 20° → S07 |
| 14 | Weather becoming hotter and drier | T rising and RH falling trend → S14 |
| 15 | Wind increases and/or changes direction | Forecast/observed Δdir or Δspeed → S11 |
| 16 | Getting frequent spot fires across line | Spot count across user control line → S19 |
| 17 | Terrain and fuels make escape to safety zones difficult | Escape time > fire arrival time → S33 |
| 18 | Taking a nap near fireline | Not detectable (fatigue card during long scenarios) |

**Common denominators of fire behaviour on tragedy fires.** These originate with Wilson (1977), who gave four. The current IRPG gives five (verified: IRPG PMS 461, Jan 2025, p. 3, verbatim). "Such fires often occur:
1. On relatively small fires or deceptively quiet areas of large fires.
2. In relatively light fuels, such as grass, herbaceous fuels, and light brush.
3. When there is an unexpected shift in wind direction or in wind speed.
4. When fire responds to topographic conditions and runs uphill.
5. During critical burn period between 1400 and 1700."

The IRPG continues (verified, same page): "Alignment of topography and wind during the critical burning period should be considered a trigger point to reevaluate tactics. Blowup to burnover conditions generally occur in less than 60 minutes and can be as little as 5 minutes."

*Correction:* the first draft gave the "fifth" denominator as a warning that air tankers can adversely affect fire behaviour. That wording appears in older training material (UNVERIFIED which edition). The current IRPG's fifth denominator is the 1400–1700 critical burn period. Wilson's original four-item wording (e.g. "running uphill surprisingly fast in chimneys, gullies and on steep slopes") is [L] and could not be re-read.

**Common tactical hazards** (verified: IRPG 2025 p. 4). Position hazards:
- building fireline downhill;
- building undercut or mid-slope fireline;
- building indirect fireline, or having unburned fuel between you and the fire;
- attempting a frontal assault on the fire, or being delivered by aircraft to the top of the fire;
- establishing escape routes that are uphill or difficult to travel.

Situation hazards include nighttime operations, and assignments or escape routes that depend on aircraft support. Most position hazards are *terrain* hazards, which FireSim can detect from the DEM.

### 2.4 Campbell Prediction System (CPS) as a teaching language

Doug Campbell's CPS (1995) [L] teaches beginners to read fire behaviour as the **alignment** of three forces: **wind, slope and preheat** (aspect/sun, and time of day).
- When all three push the fire the same way, the fire "runs".
- When they oppose, it slows.
- Fires tend to repeat the same "signature" at the same alignment.

This maps directly onto FireSim's factor attribution. An "alignment meter" (0–3 forces aligned) is an excellent beginner-level summary of the physics, provided the full simulation backs it (S38). The alignment idea is also current US doctrine. The IRPG closes each fire-environment page with "Dry fuels to burn intensely, wind to push them, instability factors from the sky, from the terrain, or from the fire itself. If they seem to align and raise your concerns, say something" (verified: IRPG 2025 pp. 34–37). CPS itself is [L]: the Campbell (1995) text could not be read.

---

## 3. Mechanisms explained physically (mountain emphasis)

### 3.1 The fire behaviour triangle in mountains

Fuel, weather and topography are interdependent in mountains:
- **Topography sets the fuel.** Aspect and elevation control vegetation: dry sclerophyll on north- and west-facing ridges versus wet sclerophyll and rainforest in south-facing gullies (e.g. the Blue Mountains, Barrington Tops).
- **Topography sets the fuel moisture.** Solar exposure matters: in the southern hemisphere, north- and west-facing slopes get the most afternoon sun (Hayes 1941 for the principle [L]; doc 02 §2.2).
- **Topography sets the local weather.** Slope winds, valley winds, channelling, lee eddies, inversions and foehn (Sharples 2009, *IJWF* 18:737–754 [L]; Whiteman 2000 [L]).

Teaching point: topography is the only leg that does not change during a fire, which is why it is predictable. You can read it from a map before the fire gets there.

### 3.2 Slope: why fire runs uphill

- **Physics.** On an upslope, the flame and plume lean toward the unburnt fuel. This shortens the distance for radiant and convective heat transfer and preheats fuel faster (Byram 1959; Rothermel 1972 [L]). Buoyant air drawn in from below is channelled up the slope face (the "indraft").
- **Attachment.** Above a critical slope the plume stops rising freely and hugs the surface: the "trench effect", first studied after the 1987 King's Cross fire. Heat transfer to the fuel ahead then jumps.
  - Laboratory critical angle: about 24° (Wu, Xing & Atkinson 2000, *Fire Safety Journal* 35:391–403). Other studies report 24–27°. In a pine-litter trench, the critical combination was 27.5° along the trench with 20° side walls (Xie et al. 2017). (Cross-checked: doc 01 §2.3, [S] there; primary not re-read here.)
  - Field corroboration: in a Southern California burnover analysis, slopes steeper than about 45% (≈24°) were the most prone to flame attachment (Lahaye et al. 2018, via doc 01). The IRPG lists "steep slopes (>45%)" as a topographic danger indicator (verified: IRPG 2025 p. 35).
- **Eruptive (blow-up) fire.** Once attached, ROS and intensity feed back on each other (a stronger indraft gives a faster fire, which gives a stronger indraft). The ROS can then accelerate without any change in wind (Viegas 2005, *Combust. Sci. Tech.* 177:27–51; Dold & Zinoviev 2009, *CTM* 13:763–793) [L].
- **Canyon runs.** Canyon or gully geometry strongly amplifies this (Viegas & Pita 2004, *IJWF* 13:253–274) [L]. These are the "chimney" runs of the tragedy fires.
- **Downslope.** Fire usually backs slowly downhill. The symmetric McArthur form `exp(−0.069θ)` halves ROS per 10° of downslope. Landscape-scale data show the real reduction is much weaker. The CSIRO kataburn correction `SF(−θ) = SF(θ)/(2·SF(θ) − 1)` never falls below 0.5 of the flat-ground ROS: ×0.57 at −20°, where the symmetric form gives ×0.25 (Sullivan, Sharples, Matthews & Plucinski 2014; cross-checked: doc 01 §2.1, [S] there). *Correction: the first draft taught "halves per 10° downslope" as the rule. That makes backing fire look safer than it is, so cards must use kataburn.* Exceptions:
  - strong winds blowing downslope, especially lee-slope and foehn events (doc 02);
  - burning material rolling downhill, which seeds spot fires below the crew (Watch Out #13);
  - the lee-side eddy, which can drive fire *up* a lee slope against the synoptic wind, or laterally (VLS; doc 02 §2.6).

### 3.3 Terrain features that trap firefighters

- **Chimneys and gullies.** Steep, narrow drainage lines, especially where the upslope direction is aligned with the wind or with afternoon anabatic flow, concentrate indraft and produce attached-flame runs (Viegas & Pita 2004 [L]). South Canyon (1994) and Mann Gulch (1949) blow-ups were upslope runs in steep drainages [L].
- **Saddles.** Wind accelerates through the low point of a ridge, and fire funnels through into the next valley. A saddle looks like a natural refuge or crossing point but is a fire corridor [L]. The IRPG: "Gap winds (saddles and passes) can be gusty and erratic". Its safety-zone guidance says to avoid "chimneys, saddles, narrow canyons" (verified: IRPG 2025 pp. 6, 35).
- **Mid-slope roads and trails.** A fire below will run up to the road, cross it via spotting and flames, and continue. The road has fuel above and below it, and escape along it may be blocked in both directions [L].
- **Ridge tops.** When a fire crests a ridge it meets stronger ridge-top winds and throws embers into the lee valley. The lee eddy can then pull fire across and down the lee face (doc 02, VLS). A crew on the ridge is exposed to both the run up the face and the spot fires behind them.
- **Box canyons, bowls and dead-end valleys.** These offer no lateral escape. At Yarnell Hill (Arizona, 2013), 19 firefighters died moving through a brush-filled bowl when a thunderstorm outflow reversed the wind [L]. The IRPG says box and narrow canyons "can hold heat, funnel winds, and support rapid increase in fire activity when inversion breaks" (verified: IRPG 2025 p. 35).
- **Slope reversals in narrow valleys.** A fire backing down one side of a narrow gorge reaches the valley floor. It then becomes an *upslope head fire* on the opposite wall, and the opposite wall has been pre-heated by radiation across the gap. The IRPG: "Slope reversals in narrow canyons can change backing fire to head fire. Be mindful of spotting potential and sunny aspects on the other side" (verified: IRPG 2025 p. 35). This is especially relevant to NSW gorges (Grose, Kanangra, Shoalhaven, New England gorges). See card S43.
- **Critical aspects.** The IRPG warns of the "critical south and west aspects [that] are in the sun during the peak burning conditions" (verified). That is northern-hemisphere wording. The NSW equivalent is **north- and west-facing** slopes [D].
- **Cliff lines and escarpments** (Blue Mountains sandstone, Budawangs, New England gorges).
  - Cliffs break the continuity of surface fuel, but the plume from a fire at the base rises up the face and deposits embers on the plateau.
  - A cliff also blocks escape.
  - Quantitative literature on cliff-line fire behaviour specific to NSW sandstone escarpments was not found this session [U].

### 3.4 Wind–terrain effects

These are detailed in doc 02 §2.5–2.6: lee separation at lee slopes of about 20° or more [V there]; VLS on lee slopes steeper than 20–25°, aspect within 30–40° of downwind, ridge wind above about 20 km/h [V there]; foehn; channelling; mountain waves.

Educational emphasis for this document:
1. **Local wind is not the forecast wind.** In valleys the wind can blow up-valley, down-valley or across the forecast direction. Belt-weather-kit readings on site can differ markedly from the automatic weather station.
   - The IRPG: "Winds you measure on the fireline may differ significantly from what is in your forecast". In hilly or mountainous terrain under weak forecast winds, surface winds are "dominated by local winds (slope/valley winds…)"; under strong forecast winds they are "a complex and changing combination of general and local" winds (verified: IRPG 2025 p. 42).
   - US typical magnitudes (verified: IRPG 2025 p. 42), to use as sanity bounds for the thermal-wind module:

     | Wind | Speed | Notes |
     |---|---|---|
     | Upslope | 3–8 mph (5–13 km/h) | |
     | Up-valley | 10–15 mph (16–24 km/h) | peaks in the afternoon |
     | Downslope | 2–5 mph (3–8 km/h) | |
     | Down-valley | 5–10 mph (8–16 km/h) | peaks late at night |

     NSW-specific values were not found [U].
2. **Behind a ridge, the "flank" can behave like a head.** VLS spreads fire *laterally* across the wind, at up to about 3–5 km/h, and throws embers downwind (doc 02 [V]).
3. **Wind changes arrive at different times at ridges and in valleys**, and terrain can delay or channel a change. Crews in a valley may feel the change later, or in a different direction, than the ridge-top lookout [L, qualitative].

### 3.5 How fire behaviour changes across the day in mountains

Qualitative sequence from Whiteman (2000) and Sharples (2009) [L]; numbers are in doc 02. Two anchors were checked in this pass:
- In deep valleys, inversion break-up usually happens **3.5–5 h after sunrise** (Whiteman 1982; cross-checked: doc 02 [V]).
- The US "critical burn period" is **14:00–17:00** local time (verified: IRPG 2025 pp. 3, 37). The IRPG says inversion breaks bring a "quick jump in temps, drop in RH, increased wind", and that "timing can vary by terrain" (verified: p. 40). The NSW-specific afternoon window is not separately published [U]. Treat 13:00–18:00 AEDT as the design window [H].

| Local time (AEDT, summer) | Atmosphere | Fire behaviour | Crew risk |
|---|---|---|---|
| Pre-dawn to ~08:00 | Valley inversions and cold-air pools; katabatic (downslope, down-valley) drainage; maximum RH; fuel moisture at its daily maximum. **Thermal belt**: a mid-slope band above the inversion that stays warmer and drier. | Valley-floor fire subdued, smoke trapped and pooled. Mid-slope thermal-belt fire may stay active all night [L]. Ridge-top fires in strong gradient winds may keep running (no nocturnal lull at exposed elevations) [L]. | Night work in unfamiliar country (Watch Out #2). Smoke-filled valleys hide fire location. |
| ~08:00–11:00 | Sun heats east- then north-facing slopes; anabatic upslope flow begins; the **inversion breaks** (often mid-morning) [L]. | Sudden increase when the inversion breaks: smoke lifts, wind mixes down, the fire "wakes up" [L]. East slopes become active first. | A quiet morning is deceptive (common denominators). |
| ~12:00–17:00 | Maximum temperature, minimum RH (typically mid-to-late afternoon); strongest upslope and up-valley winds; deepest mixing, so ridge-top winds mix down [L]. | Peak ROS and intensity; north- and west-facing slopes driest; spotting and crowning most likely. Many US entrapments occur in the afternoon (Page et al. 2019 [L]). | Critical period. Pre-frontal NW winds peak. |
| ~17:00–21:00 | Wind change (SW front inland; "southerly buster" on the coast and escarpment) often late afternoon or evening [L]; upslope flow collapses near sunset and reverses to downslope. | Direction changes from the front *and* from the slope-wind reversal. Flanks become heads. Fires on west-facing slopes remain active late. | Wind-change and DMZ card. Fatigue. Linton's entrapment was at about 20:45 after a wind change (secondary: archived Wikipedia text). |
| Night | RH rises, but may not recover on ridges or in thermal belts. Some nights have "dry slots" or foehn-type drying (Mills 2008 [L]; doc 02). | Backburning window (§7), unless overnight RH does not recover. | Backburn escape if the forecast recovery fails. |

### 3.6 Wind changes and the dead-man zone

- **Geometry.** A fire driven by a steady NW wind is long and narrow, with long flanks. When the wind swings to the SW, the *whole east flank* becomes a head fire. The new head width is about the flank length [D].
- **Physics of "immediate" full speed.** Head-fire ROS depends on head width: narrow heads spread slower than wide ones until the width exceeds a threshold that depends on fuel and wind (Cheney & Gould 1995, *IJWF* 5:237–247, grassland) [L].
  - A point ignition therefore takes time to accelerate. A flank turned into a head is *already* wide and so reaches quasi-steady ROS almost at once.
  - The Project Vesta finding is summarised as: "when the wind changes direction, the line of fire will move out at its maximum rate of spread almost immediately, and that that speed was nearly three times what was previously thought" (verified in secondary: archived Wikipedia text read this pass; primary paper not read).
  - (UNVERIFIED — could not be found in any source read in this pass): the first draft quoted a secondary summary saying Vesta fires "can reach a spread rate of 600 m h⁻¹ in under three minutes". It must not be shown in-app until it is confirmed in Cheney, Gould & McCaw (2001) or Gould et al. (2007).
  - Independent US statement (verified: IRPG 2025 p. 3): "Blowup to burnover conditions generally occur in less than 60 minutes and can be as little as 5 minutes."
- **The DMZ.** "The area directly around a bushfire that is likely to burn within five minutes given the current wind conditions or an anticipated change in wind direction". Its extent "is highly dependent on terrain, windspeed, fuel type and composition, relative humidity and ambient temperature, and can range from under 100 m to well over 1 km" (verified in secondary: archived Wikipedia text; attributed to Cheney et al. 2001, primary not read). The core statement from the abstract [V]: firefighters in parallel or indirect attack are in a DMZ "if they do not appreciate the time and space required to find a safe refuge … if the wind direction changes, the fire can advance so rapidly that the firefighters have very little time to seek refuge in the burnt area behind a suppressed portion of line, or egress elsewhere, before the fire overwhelms them."
- **Practical corollaries** [L, widely taught]:
  - the same secondary source describes Australian practice as "attacking the fire from the flanks, or the rear, so that burnt ground is always nearby". Several inquiries led to SOPs to keep a **crew-protection water reserve** in the tanker, quoted as 250 L (secondary: archived Wikipedia text; UNVERIFIED against current NSW RFS SOPs, and the volume may differ by appliance);
  - direct attack from the burnt edge ("one foot in the black"), with the black as the refuge;
  - be most cautious on the flank that will become the head after the forecast change (in NSW usually the **eastern or north-eastern flank** before a SW/S change);
  - know the change's arrival time and pass it on (Linton [V]).

### 3.7 Spotting and ember-driven behaviour (education view)

Physics details are in the ember research document.
- Eucalypt bark types, above all **stringybarks** and **ribbon/candle barks**, are prolific firebrand sources.
  - Messmate stringybark's notoriety is explained by bark morphology and fuel-bed ignition potential (Ellis 2011, *IJWF* 20:897–907) [L].
  - Ellis (2015, *IJWF* 24:225–235) tested dry-eucalypt litter at 4–21% moisture and 0–2 m/s airflow. The fitted models "confirm the dominating influence of fuel moisture" (cross-checked: doc 06 §2.7, [V] there). The logistic coefficients were not retrieved, so no numeric ignition-probability threshold may be quoted in-app.
  - Ember production is low at low intensity. "Very little ember production and spot fire activity at less than 1,000 kW/m" (Gould et al. 2007a, quoted in the AFDRS-RP Table 2.9; verified this pass).
- Long-distance spotting in SE Australia is associated with large source fires, strong winds and steep terrain within the source fire. Across 338 line-scan observations (2002–2018), most spot fires landed within about 5 km, with occasional spots out to about 14 km (Storey et al. 2020, *IJWF* 29:459–472; cross-checked: docs 01 and 02, [S]/[V] there).
  - On Black Saturday, spot fires landed **up to 33 km** ahead of the Kilmore East fire (Cruz et al. 2012, *FEM* 284:269–285; cross-checked: doc 02, verified there from the abstract). *The first draft's "about 30 km or more" is corrected to 33 km.*
- **Teaching points:**
  - (a) spot fires ahead mean the fire is effectively *wider and closer* than the main edge suggests;
  - (b) spot fires coalesce and form junction zones;
  - (c) in mountains, embers lofted from a ridge land in lee eddies and on the next slope, starting fires *behind* crews on the ridge;
  - (d) frequent spots across the line is itself a Watch Out (#16).

### 3.8 Plumes, columns, pyroCb and whirls: reading the smoke

- **Plume-dominated vs wind-driven.** Byram's convection number compares the fire's buoyant energy with the kinetic energy of the wind relative to the fire (Byram 1959; Nelson 1993; Morvan & Frangieh 2018, *IJWF* 27:636–641) [L]:
  - `N_c = 2 g I / (ρ c_p T_a (U − R)³)`;
  - large N_c: plume-dominated (vertical column, surface indraft, spread less tied to the ambient wind, erratic);
  - small N_c: wind-driven (bent-over plume).
  - The transition is fuzzy. N_c > 10 is taken as plume-dominated and N_c < 2 as wind-driven (Morvan & Frangieh 2018; cross-checked: doc 02 §2.6, which marks form and thresholds [V]; not re-read in this pass). Between 2 and 10 is a mixed regime.
- **Column indicators, IRPG version** (verified: IRPG 2025 pp. 37–38, US doctrine):
  - *Plume-dynamics indicators*: a well-developed, near-vertical column; pyrocumulus or an ice cap on the column; thunder or lightning flashes; sprinkles of rain; sudden calm; becoming hazy, with "smoke at your feet"; a changing column with "alternating and strengthening inflows, and outflows". The IRPG: "On-scene factors (thunder/lightning, sprinkles, sudden calm, smoke at your feet) mean imminent wind changes."
  - *Rapidly changing fire-behaviour indicators*: smouldering fires pick up; trees begin to torch; fire whirls beginning; a leaning or sheared column; increased frequency of spot fires.
  - *Stable atmosphere*: smoke is trapped under an inversion, with lower fire behaviour. "Watch Out: Smoke begins to boil through the inversion … Expect lowering RH, possible wind shifts, and increasing flames, spread, and spotting."
  - *Unstable atmosphere*: smoke rises high and disperses. "Watch Out: Active spread, intense burning, large fire growth."
- **Column indicators, further widely taught heuristics** [L]; not quantitative physics:
  - a tall, vertical, well-defined column with a hard-edged cauliflower top means strong convection, and possibly a plume-dominated fire;
  - a column **leaning** hard over means wind-driven spread and spotting downwind;
  - smoke rising and then **flattening** at a level means a stable layer or inversion caps the plume. The fire is often subdued, but watch for break-up;
  - a **white pileus/cap or anvil** on the column means pyroCu/pyroCb (Fromm et al. 2006, Canberra 2003; McRae et al. 2015) [L];
  - a column **collapsing**, with its top sinking, the column dissipating and sudden gusty winds in all directions, means a downdraft or outflow. Expect abrupt changes in spread direction (the Yarnell Hill outflow was thunderstorm-driven) [L];
  - **smoke colour**: white or light grey suggests fine and moist fuels or steam; dark grey to black suggests heavy fuel, high intensity or crown involvement. A **sudden change from white to black** means the fire has moved into heavier fuel or is crowning [L heuristic].
  - Colour is influenced by light angle and distance, so treat it as a *prompt to look closer*, never as a measurement.
- **PyroCb in NSW.**
  - Canberra, 18 January 2003: a pyroCb and a pyro-tornado (Fromm et al. 2006, *GRL* 33:L05815; McRae et al. 2013, *Nat. Hazards* 65:1801–1811) [L].
  - Black Summer 2019–20 had an unprecedented pyroCb outbreak in SE Australia (Peterson et al. 2021, *npj Clim. Atmos. Sci.* 4:38) [L].
  - Wambelong fire, Warrumbungles, January 2013 [L].
  - Criteria are in doc 02: C-Haines, PFT and the escalation pathways of McRae et al. (2015).
- **Fire whirls and vortices** form where there is strong vorticity: in wind shear behind ridges, at the lee edge of a fire, where fire lines meet, and in the pyroconvective inflow (Forthofer & Goodrick 2011, *J. Combustion* 984363) [L]. They throw embers, change direction erratically and can be violent.
  - The IRPG lists "whirlwinds" (mature dust devils and fire whirls) at "50 mph [80 km/h] and higher". It notes that "strong winds in outer portion of whirl can lift large embers" (verified: IRPG 2025 p. 41).
  - It gives thunderstorm- and pyrocumulus-induced outflows and downdrafts as "25–35 mph, can exceed 60 mph" (40–56, over 95 km/h), "gusty and erratic… winds radiate from center of storm" (verified: IRPG 2025 p. 41).
  - The Jingellic truck rollover (30 December 2019) was reported as a truck "overturned by strong winds" (news reports; the PM's statement confirms the death). Attribution to a fire-generated vortex versus a pyroCb downdraft is UNVERIFIED; the coronial findings were not retrieved.

### 3.9 Junction zones (backburn meets main fire; spot fires coalescing)

- **Geometry [D].** Two straight fronts, each advancing normal to itself at speed R and meeting at an acute angle α, have an intersection point that moves along the bisector at `V_j = R / sin(α/2)`:
  - α = 60°: V_j = 2R;
  - α = 30°: V_j ≈ 3.9R;
  - α = 10°: V_j ≈ 11.5R.
- **Physics [L].** Laboratory and field experiments show the junction accelerates even faster than geometry alone, because the two fires' heat and induced flows interact: "jump fire" (Viegas et al. 2012, *IJWF* 21:843–856; Raposo et al. 2018, *IJWF* 27:52–68).
- **Teaching point.** When a backburn is drawn in toward the main fire, or two spot fires join, the pocket of unburnt fuel between them can burn out with a sudden, violent "slam", with high intensity and strong local winds. Never be in that pocket.
- **Doctrine link.** The WA Parks and Wildlife forest suppression table says that at Very High fire danger (2–3 MW/m), "Junction zone effect must be considered when determining required back burn depth" (verified: AFDRS-RP Table 2.6, citing Dept of Parks and Wildlife 2017).

### 3.10 Fuel: dead fine fuel moisture, structure and time since fire

The fuel physics is in the fuel research documents. For education, three points matter:
- **Dead fine fuel moisture (leaf litter).** This is the dominant weather-driven fuel variable.
  - In Vesta (Cheney et al. 2012) the moisture function is `φ_M = 18.35 · MC^−1.495` for 4 < MC ≤ 20%. As implemented in the AFDRS, φ_M = 2.31 for MC ≤ 4% and φ_M = 0 (no spread) above 20% (verified: FBI-TG eq. 3.47). Going from 12% to 6% moisture multiplies spread by (12/6)^1.495 ≈ 2.8 [D].
  - Dead fine fuel moisture in dry forest (Matthews et al. 2010, as used in the AFDRS; verified: FBI-TG eqs 3.48–3.50), MC in %, RH in %, T in °C:
    - sunny afternoon (12:00–17:00, Oct–Mar): `MC = 2.76 + 0.124·RH − 0.0187·T`;
    - overcast daylight: `MC = 3.60 + 0.169·RH − 0.0450·T`;
    - night: `MC = 3.08 + 0.198·RH − 0.0483·T`.
  - Examples on a sunny afternoon [D]:
    - RH 15%, T 38 °C gives MC ≈ 3.9%;
    - RH 30%, T 30 °C gives MC ≈ 5.9%;
    - RH 40%, T 30 °C gives MC ≈ 7.2%.

    The first two are the "bone dry" values that trigger S22. (φ_M is continuous at 4%, where 18.35·4^−1.495 ≈ 2.31 [D].)
  - The app should show it as a "how easily does it catch and spread" dial, with the aspect and time-of-day explanation attached.
- **Structure.** Elevated fuels (understorey shrubs) and bark raise flame height and create ladders into the canopy.
  - The fuel inputs should use the classes of the Overall Fuel Hazard Assessment Guide (Hines et al. 2010, 4th edn) [L], which NSW practice is based on.
  - Van Wagner's (1977) crown-initiation criterion is a transparent physical explanation for "why the fire went into the crowns" [L] (§4.6).
- **Time since fire.** Fuel re-accumulates after fire, typically modelled as `w(t) = w_ss(1 − e^{−kt})`, with t in years since fire and w in t/ha (Olson 1963). The AFDRS applies this curve separately to the surface, near-surface, elevated, bark and canopy layers (verified: FBI-TG eqs 3.52–3.56). Parameters by NSW vegetation type are in doc 03/05; they are not repeated here.
  - Teaching points: recently burnt or hazard-reduced ground slows fire and can be a refuge or anchor. Long-unburnt country carries heavier, more continuous and more elevated fuel.
  - **The black is not automatically safe in forests**: unburnt canopy can re-burn, hazard trees fall, and patchy burns leave fuel (S39, S40).

---

## 4. Quantitative toolkit (equations used by the education layer)

These equations appear in "why" explanations and safety overlays. The main spread model may use more sophisticated equivalents from other documents; the education layer must use **the same numbers as the simulation**, so these are fallbacks and explanatory forms.

**4.1 McArthur Forest FFDI** (Noble, Bary & Gill 1980) [L]:
`FFDI = 2·exp(−0.450 + 0.987·ln D − 0.0345·H + 0.0338·T + 0.0234·V)`
- D is the drought factor (0–10, dimensionless);
- H is relative humidity (%);
- T is air temperature (°C);
- V is 10-m open wind speed (km/h).

Legacy categories [L]: Low–Moderate 0–11, High 12–24, Very High 25–49, Severe 50–74, Extreme 75–99, Catastrophic 100+.

Since 1 September 2022 the **AFDRS** has replaced these ratings with Moderate / High / Extreme / Catastrophic, based on a Fire Behaviour Index (FBI) with bands Moderate 12–23, High 24–49, Extreme 50–99, Catastrophic 100+ [L; verify]. Cards should use AFDRS terms.

**4.2 McArthur Mk5 forest ROS with slope** (Noble et al. 1980) [L]:
`R = 0.0012 · FFDI · W · exp(0.069 θ)`
- R in km/h; W is fine fuel load (t/ha); θ is ground slope in degrees (+ upslope, − downslope).
- The slope factor `exp(0.069θ)` gives ×2.0 at 10°, ×4.0 at 20°, ×2 per 10° [D].
- The flat-ground part is known to under-predict fast fires in dry eucalypt forest; Vesta supersedes it (Cheney et al. 2012, *FEM* 280:120–131) [L].
- The slope rule's validity is only established to about 20°; above that, see attachment and eruption (§3.2) [L].

**4.3 Byram fireline intensity** (Byram 1959) [L]:
`I = H · w · R`
- I in kW/m; H is heat yield (kJ/kg), about 18,000–18,700 for eucalypt fuels [L; the exact value used by the spread model should be reused]; w is fuel consumed (kg/m²); R is ROS (m/s).
- Example [D]: w = 1.5 kg/m² (15 t/ha), R = 0.5 m/s (1.8 km/h), H = 18,600 gives I ≈ 14,000 kW/m.

**4.4 Suppression-difficulty bands.** These are rule-of-thumb bands used in Australian training [L; exact source and values must be confirmed]:
- below about 500 kW/m: hand tools can work at the edge;
- up to about 2,000 kW/m: tankers and machines;
- up to about 4,000 kW/m: aircraft may help;
- above about 4,000 kW/m: direct attack is unsafe and ineffective, so use indirect tactics;
- above about 10,000 kW/m: crowning and massive spotting; uncontrollable.

Present these as bands with "approximately", and tie them to observed flame height through the model.

**4.5 Flame length from intensity** (Byram 1959) [L]:
`L = 0.0775 · I^0.46` (L in m, I in kW/m).
- This is a generic relation. For eucalypt forests, the Vesta flame-height model (which includes elevated-fuel height) should be used if the spread model provides it [L].

**4.6 Crown-fire initiation** (Van Wagner 1977, *Can. J. For. Res.* 7:23–34) [L]:
`I₀ = (0.010 · z · (460 + 25.9 · m))^1.5`
- I₀ is the critical surface intensity (kW/m); z is canopy base height (m); m is foliar moisture content (%).
- Crowning is predicted when surface I ≥ I₀. It was developed for conifers; eucalypt canopies differ (bark and elevated fuels act as ladders), so use it only as an *explanatory* "ladder" criterion [L/U].

**4.7 Safety refuge and separation distance:**
- Australian doctrine: clear radius `r ≥ 4 · FH_pred` in the direction of fire approach [V] (after Butler & Cohen 1998, *IJWF* 8:73–77, a radiant-only model on flat ground) [L].
- US empirical SSD (Page & Butler 2017, *IJWF* 26:655–667; NWCG IRPG) [L]:
  - `SSD = 8 · H_v · Δ`, where H_v is vegetation height (m) and Δ is a tabulated slope-wind factor;
  - Δ = 1 for light wind on flat ground, rising to about 10 for extreme wind on steep slopes;
  - **copy the intermediate table values from the current IRPG (PMS 461); do not guess them.**
- Radiant-heat tolerance thresholds for protected skin (Butler & Cohen used about 7 kW/m²) [L]. Convective heating from wind and slope is the reason SSD grows (Butler 2014 review, *IJWF* 23:295–308) [V existence, L content].

**4.8 Escape travel rate** (Tobler 1993, NCGIA TR 93-1) [L]:
`v = 6 · exp(−3.5 · |tan θ + 0.05|)` (km/h), where tan θ is the signed gradient in the direction of travel. Multiply by 0.6 off-track (Tobler) [L]. Campbell, Dennison & Butler (2017, *IJWF* 26:884–895) measured firefighter-relevant travel rates falling with slope and vegetation density [L].

Worked comparison [D]:

| Terrain | Walking speed |
|---|---|
| Flat, on track | 6·e^(−0.175) = **5.0 km/h** |
| 20° uphill (tan = 0.364), on track | 6·e^(−1.449) = **1.4 km/h** |
| 20° uphill, off track | **0.85 km/h** |

Against that, a fire at FFDI 40 in 15 t/ha fuel on a 20° upslope under Mk5 spreads at 0.0012·40·15·3.97 = **2.9 km/h**. The fire is two to three times faster than the escaping firefighter, even before Mk5's under-prediction is accounted for [D].

**4.9 Byram convection number** (§3.8) [L]:
`N_c = 2gI / (ρ c_p T_a (U − R)³)`
- g = 9.81 m/s²; I in W/m (so ×1000 from kW/m); ρ ≈ 1.1–1.2 kg/m³; c_p ≈ 1005 J/(kg·K); T_a in K; U and R in m/s.
- The reference height for U varies between authors (midflame or 10 m) [U].

**4.10 Junction speed** (§3.9) [D]: `V_j = R / sin(α/2)`.

**4.11 Wind-change DMZ distance** [D from the DMZ definition]:
`D_DMZ = R_post × t_DMZ`, with t_DMZ = 5 min (Cheney et al. 2001 [V secondary]).

| R_post | D_DMZ |
|---|---|
| 1 km/h | 83 m |
| 3 km/h | 250 m |
| 6 km/h | 500 m |
| 12 km/h | 1 km |

This is consistent with the "<100 m to >1 km" range [V].

**4.12 Trigger point** (Cova et al. 2005, *Trans. GIS* 9:603–617; Fryer et al. 2013, *IJWF* 22:883–893) [L]. A crew must leave when the fire's travel time to them equals `t_escape + t_margin`. FireSim computes fire arrival time by reverse travel-time on the spread field (§9.3).

**4.13 C-Haines and PFT:** see doc 02 §2.6 (Mills & McCaw 2010; Tory & Kepert 2021).

---

## 5. Case studies: what happened, and what the app should be able to recreate

| Case | Setting | Mechanism | Lessons for cards | Evidence |
|---|---|---|---|---|
| **Linton, Vic**, 2 Dec 1998 | Forest and plantation, undulating | SW change turned the uncontrolled east flank into the head; five Geelong West CFA firefighters died at and near their tanker. The coroner reported on 11 Jan 2002 with 55 recommendations, citing training and communication failures (the change message was not received). | S11, S12, communication prompt | [V] (Vic coroner report; The Courier) |
| **Wangary, SA**, 11 Jan 2005 | Farmland and grass, Eyre Peninsula | A "contained" fire re-escaped (it had continued to smoulder in a swamp). The wind change opened a wide front. Nine deaths, 93 homes, about 78,000 ha, just over two hours to the sea. | S11, mop-up and "contained ≠ out" | [V] (ABC 2025; SA coroner summary; GA fieldwork report) |
| **Upper Beaconsfield, Vic**, 16 Feb 1983 (Ash Wednesday) | Forested hills | Twelve CFA firefighters killed as the wind change swung the fire onto them. | S11 | [L; verify count and detail] |
| **Black Saturday, Kilmore East**, 7 Feb 2009 | Ranges north of Melbourne | Extreme pre-frontal NW winds; the SW change turned a long flank into a very wide head; long-range spotting; pyroCb. | S11, S20, S27 | [L] (Cruz et al. 2012; VBRC 2010) |
| **Canberra / Brindabellas**, 18 Jan 2003 | Mountains to urban edge | VLS on lee slopes, pyroCb, pyro-tornado | S09 (doc 02), S27, S28 | [L] (Fromm 2006; McRae 2013, 2015) |
| **Green Wattle Creek, NSW**, 19 Dec 2019 | Southern highlands, near Buxton | Two Horsley Park RFS volunteers (Geoffrey Keaton, Andrew O'Dwyer) killed when a tree fell onto or in front of their tanker, which then left the road | S40 (hazard trees), vehicle travel in fire areas | [L; coronial findings not retrieved] |
| **Jingellic (Green Valley fire), NSW**, 30 Dec 2019 | Upper Murray, hilly | RFS volunteer Samuel McPaul killed when an extreme fire-generated wind or vortex overturned a heavy tanker during a pyroconvective event | S27, S28 | [L; verify details against the coronial findings] |
| **Mann Gulch, Montana**, 5 Aug 1949 | Steep grass slope | Fire crossed the gulch below the crew and ran upslope. Crew raced uphill; 13 died. Dodge's escape fire. | S01, S06, S33 | [L] (Rothermel 1993) |
| **South Canyon, Colorado**, 6 Jul 1994 | Steep slope in Gambel oak, cold-front passage | Crew above the fire on a steep slope; the fire ran up gullies after a frontal wind; 14 died | S01, S03, S06, S11 | [L] (Butler et al. 1998) |
| **Yarnell Hill, Arizona**, 30 Jun 2013 | Brush-filled bowl, thunderstorm outflow | Wind reversal from outflow; crew in a box canyon without lookout visibility; 19 died | S26, S28, S37 | [L] |

**Pattern for teaching** (from Wilson 1977 and Page et al. 2019 [L]): small or quiet fires; light fuels; a wind shift; steep terrain with chimneys; an afternoon peak; crews positioned upslope of the fire or on the "flank that becomes the head"; escape routes that were too long, ran uphill, or were blocked; and missing or late information about the wind change.

A scenario library of "replays" of these cases on *NSW analogue terrain* (not a re-enactment of real fatalities on the real site, out of respect for families) is recommended [H].

---

## 6. Safe work practices in steep terrain (content for cards and scenarios)

These are widely taught AFAC, NSW RFS and NWCG principles [L], except where marked [V]. Final wording must be checked against NSW RFS doctrine.

1. **Anchor, flank and pinch.** Start control line from a secure anchor (road, rock, water, previously burnt ground) and work along the flanks toward the head, keeping the burnt ground at your back (Watch Out #8).
2. **Work from the black** ("one foot in the black") wherever the fire intensity allows direct attack. The black is the nearest refuge in a wind change (dead-man zone). In forest, check the black for hazard trees and unburnt canopy.
3. **Do not work above a fire on a slope.** If downhill line construction is unavoidable, NWCG specifies strict conditions [L]:
   - a downhill checklist;
   - a lookout who can see the fire below;
   - the line anchored at the top;
   - communication with the crew below;
   - escape routes that do not go uphill ahead of the fire;
   - fire below that is not expected to make a run.
4. **Avoid chimneys, gullies, saddles and mid-slope positions** when fire is below, or when fire can be carried into them by a wind change.
5. **Rolling material.** Burning bark, logs and cones roll downslope and start spot fires *below* a control line or a crew (Watch Out #13). In steep eucalypt country, patrol below the line.
6. **Escape routes.**
   - They must work at jogging pace [V].
   - They must be timed, ideally walked, with gear.
   - They should not climb ahead of the fire.
   - Assume the travel rate falls sharply with slope (Tobler, §4.8).
   - Two routes are preferable; with only one, a refuge must be within 100 m [V].
7. **Safety refuges.**
   - At least 4× predicted flame height of clearance in the direction of fire approach [V].
   - Prefer large, flat, burnt-out or non-fuel areas: roads with wide clearings, rock platforms, bare paddocks, wide burnt ground.
   - Avoid refuges at the top of chimneys, in saddles, or downwind of heavy fuel.
   - Consider SSD with wind and slope (§4.7).
8. **Vehicles.**
   - Park facing the way out, in a cleared area, not in saddles or gullies and not under hazard trees.
   - Keep crew-protection systems ready. NSW RFS tankers carry crew protection (cabin deluge sprays, radiant curtains) and crews practise burnover drills [L].
9. **Hazard trees.**
   - Burning or fire-weakened trees fall without warning, especially in the black and along roads after the front passes (Green Wattle Creek [L]).
   - Keep at least two tree-lengths from trees being felled or known to be burning internally [L, a widely used rule].
   - Look up.
10. **Heat stress and fatigue in steep terrain.** Hand-tool work on slopes is extremely demanding (Project Aquarius, Budd et al. 1997, *IJWF* 7(2)) [L]. Fatigue degrades judgement (Watch Out #18). The app should add fatigue prompts in long scenarios [H].
11. **Lookouts** need a view of *both* the fire and the crew, and knowledge of the trigger points (§9.3).

---

## 7. Back-burning in mountains: principles and risks

Terminology (Australia): a **backburn** is fire lit from a control line to consume fuel ahead of the main fire (indirect attack). A **burn-out** consumes unburnt pockets between the line and the fire edge. A **hazard-reduction burn** is a prescribed burn. LACES applies to all prescribed burning activities [V].

**Principles** [L unless marked; confirm against the NSW RFS Prescribed Burning protocol and the Crew Leader training material]:
- **Secure anchor and control line first.** The line must be wide enough and patrolled. The depth of black created must exceed the likely short-range spotting distance before the main fire arrives.
- **Test burn.** Light a small test section and observe flame height, spread and spotting before committing.
- **Light so the fire backs.** Light from the top of slopes and along ridge-top control lines so the backburn **backs downhill** and into the wind, at low intensity.
  - **Never light below yourself, or below other crews, on a slope.**
  - Never light at the base of a chimney that leads up toward a line or crew.
- **Timing.** Use periods of low fire danger: evening and night, when RH rises and winds drop, and before a forecast change. Complete and secure the burn well before that change.
  - Mountain nights are not uniform: thermal belts and ridge-top winds can keep fire active overnight [L; doc 02].
- **Plan for the wind change.** A backburn not complete before a change has created a new flank that can become a head.
- **Watch the junction.** As the backburn and the main fire converge, the unburnt strip burns out violently (junction zone, §3.9). Some operations deliberately use the main fire's indraft to draw the backburn toward it. This is an advanced technique with high risk if the column collapses or the wind shifts [L].
- **Big-area lighting creates its own weather.** Lighting a large area at once can generate a convection column of its own, with indrafts and spotting [L].
- **Spotting over the line.** Have holding crews on the downwind side, and lookouts watching for spot fires (Watch Out #16).

**Mountain-specific risks** [L]:
- slopes and gullies below the line turn a backing fire into a run the moment it reaches the base of an adjacent upslope;
- valley-wind reversals (up-valley by day, down-valley by night) can reverse the backburn's direction;
- inversion break-up the next morning re-activates the fire;
- lee eddies and spotting across the ridge on which the control line sits.

The NSW Bushfire Inquiry (Owens & O'Kane 2020) [L] discussed community concerns about backburns that escaped during 2019–20 (several in the Blue Mountains and adjoining areas) and recommended improved fire-behaviour capability. The specific incident details were not verified this session.

**App support** [H]:
- a "backburn planner" sandbox: draw a lighting line, choose the time of lighting, run with the forecast;
- the app highlights: lighting below crews; chimneys leading to the line; backburn not complete before the forecast change; junction zones forming; spot fires across the line.

This is one of the highest-value features for building intuition.

---

## 8. How instructors build fire-behaviour intuition: evidence and design implications

- **Recognition-primed decision making (RPD).** Klein, Calderwood & Clinton-Cirocco (1986) [L] found that fireground commanders mostly do not compare options. They recognise the situation as typical, mentally simulate a single course of action, and act. Expertise is a library of patterns plus the ability to run mental simulations. **Implication:** give beginners many varied patterns quickly, on terrain that looks like their own, with feedback.
- **Situation awareness.** Endsley (1995) [L] describes three levels: perception, comprehension and projection. Beginners stall at perception ("there's smoke"). FireSim's value is Level 3, projection ("in 20 minutes it will be at the saddle"), with the *why* that links Level 2 to Level 3.
- **Dynamic decision making.** In microworld studies, including firefighting microworlds, Brehmer (1992) [L] found people handle delays, feedback lags and exponential or accelerating processes poorly. Fire acceleration on slopes, delayed wind-change effects and spot-fire growth are exactly these. **Implication:** show time-lapse and "time-to-arrival" explicitly, and ask the trainee to predict first.
- **Predict–Observe–Explain (POE)** (White & Gunstone 1992) [L]. This science-education technique confronts misconceptions: the learner commits to a prediction, sees the outcome, then reconciles the two. **Implication:** before revealing a simulation step, the app asks "Where will the fire be in 30 min?" (tap on the map). It then scores the prediction and explains the gap with factor attribution.
- **Sand tables, tactical decision games (TDGs) and staff rides.** These are standard in US wildland fire training through NWCG leadership programs and the Mann Gulch and South Canyon staff rides [L], and are used in Australian agencies [L]. Instructors present a terrain model, a situation and a time limit, and trainees decide. Digital sand tables (e.g. SimTable in the US [L]) add simulated spread. Rigorous outcome evaluations specific to wildland fire were not found this session [U].
- **Transferable evidence.** A meta-analysis of technology-enhanced simulation in health professions education found large effects on knowledge and skills compared with no intervention (Cook et al. 2011, *JAMA* 306:978–988) [L]. Effects compared with other instruction were smaller. **Implication:** FireSim should complement instructor-led training, not replace it.
- **Australian research context.** Bushfire CRC studies of incident-management decision making, e.g. McLennan et al. (2006, *J. Contingencies & Crisis Mgmt* 14:27–37) [L], and CSIRO's knowledge-based fire-behaviour tools such as Amicus [L] show a tradition of decision-support and fire-behaviour training tools in Australia.
- **Risks of simulation training** [L/H]:
  - over-trust in a model ("the app said it wouldn't cross");
  - false precision;
  - negative transfer if the model is wrong in a systematic way (e.g. no VLS, no spotting).

  Mitigations:
  - show uncertainty (ensembles or ranges);
  - label every card's confidence;
  - include "the model can't see this" cards (S36, S37);
  - always end in doctrine.

---

## 9. Implementation recommendations

### 9.1 Architecture of the teaching layer [H]

- **Insight engine** in the same Web Worker as the simulator, or a sibling worker sharing a SharedArrayBuffer.
  - It evaluates card triggers every simulated minute, using fields the simulator already has: ROS vector, intensity, flame height, fire arrival time, ember landing density, plume vertical velocity and wind field. It also uses precomputed static terrain masks: gully, saddle, ridge, mid-slope road, lee mask per wind sector, and cliff.
  - Cost is linear in the number of perimeter cells plus user objects (crews, lines, refuges). It is negligible relative to the coupled solver.
- **Static terrain precomputation** at scenario build (once, in less than 2 s on a phone for 300×300 cells [H]):
  - slope and aspect at 30 m and 150–250 m smoothing;
  - TPI at 150 m and 500 m radii;
  - plan and profile curvature;
  - D8 flow accumulation for gullies and chimneys;
  - saddle points from the Hessian sign test;
  - ridge lines;
  - cliff mask (slope > 60° [H]).
- **Card state machine.** Each card has the states `idle → armed → shown → cooldown`.
  - Use hysteresis: the trigger turns off at 80% of its on-threshold [H].
  - Per-card cooldown is 15 simulated minutes [H].
  - Severity classes are **Danger** (red, interrupts playback), **Watch Out** (amber) and **Insight** (blue).
  - At most one new card every 20–30 s of wall-clock time; the queue is sorted by severity, then by proximity to user crews.
- **Factor attribution.** For each highlighted cell, decompose the ROS multiplicatively: `R = R_ref · Π f_i`, with f_i for wind, slope, dead-fuel moisture, fuel load and structure, pyroconvective indraft, spotting contribution, and so on. Show each factor's share, `s_i = |ln f_i| / Σ_j |ln f_j|`, and phrase the top three as "because …" statements [H].
  - This applies directly if the spread model is multiplicative (McArthur or Vesta-like).
  - For a coupled model, compute counterfactual ROS with each factor set to its reference (flat, calm, 10% moisture). This takes one extra evaluation per factor per highlighted cell and is cheap.

### 9.2 User-editable inputs relevant to safety and education

| Input | Why | Notes |
|---|---|---|
| Crew, vehicle and lookout positions (tap) | DMZ, escape, above-fire, viewshed cards | Store the time placed; crews can "walk" along routes |
| Escape routes (draw) and safety refuges (polygon) | E and S of LACES | Refuge clearance auto-measured from the fuel grid; user can override |
| Control lines and anchor points | Watch Out #8, #16; junction | Line width is editable (m) |
| Backburn lighting lines, with time and pattern (strip/spot) | §7 planner | |
| Wind-change override: time, new direction, speed | DMZ scenarios; "what if the change is early?" | Default from the forecast; sliders ±2 h and ±45° |
| Observed conditions (belt weather kit: T, RH, wind, direction) | Local truth beats the AWS | Blended into the initial state |
| Observed flame height and "fire has jumped here" markers | Re-anchoring the simulation; spotting education | |
| Fuel edits: surface, elevated and bark hazard (OFHAG classes), time since fire, recent HR burn polygons | Fuel inputs | Plain-language pickers with photos |
| Smoke/column observation (vertical, leaning, flattened, capped, collapsing) | Links what they see to cards S25–S28 | Education only; it also nudges the plume parameters |
| Inversion present (yes/no), time of day | Diurnal cards | |
| Prediction taps (POE) | Learning loop | Scored against the simulation |

### 9.3 Safety overlays and their algorithms [D/H]

1. **Fire arrival time T_a(x).** The spread model already produces it: a level set or minimum travel time. For DMZ and trigger computations under *hypothetical* winds, run a cheap second spread using a Dijkstra or fast-marching sweep on the fire grid, with elliptical ROS from the post-change wind field (for example the diagnostic wind recomputed for the new direction).
   - Cost is O(N log N), about 90k cells at 30 m over 9 km², so under 100 ms in a worker [H].
   - Recompute every 5–10 simulated minutes, or when the user edits.
2. **DMZ polygon.** `DMZ = {x : T_a,post(x) − t_change ≤ 5 min}`, seeded from the current perimeter at t_change. Also compute a "worst direction" DMZ (the maximum over wind directions within ±90° of the forecast change) for the education mode. Shade it and tag any crew inside it.
3. **Escape time T_e(crew → refuge).** Least-cost path over the DEM, with cost `1/v(θ)` from Tobler, an off-track factor of 0.6 [L], a PPE/load factor of 0.8 [H], and a vegetation-density penalty (Campbell et al. 2017 [L]; coefficients not verified).
   - Safety margin M = max(5 min, 0.5·T_e) [H].
   - **Card S33 fires if** `T_a(crew) < T_e + M` along the route, or if the route crosses cells whose `T_a` is less than the time the crew reaches them.
4. **Trigger points.** Along the predicted fire path, mark the contour `T_a(x) = T_a(crew) − (T_e + M)`: "when the fire reaches this line, you must be moving."
5. **Refuge check.** Clear radius r versus 4·FH_pred (doctrine) and versus SSD with Δ from the IRPG table (once verified). Also check terrain red flags: saddle, chimney top, mid-slope, downwind of heavy fuel.
6. **Viewshed** from lookouts and crews, over the DEM plus canopy height (the project already fetches canopy height). Check which active perimeter cells and which crews are visible.

### 9.4 Performance budget and simplifications [H]

- Insight evaluation plus attribution is under 5% of worker time.
- The DMZ/trigger sweep costs about 50–100 ms per call, at most every 5 simulated minutes. A 6-hour scenario therefore needs about 72 calls, roughly 7 s total. **This is significant: run it at lower resolution (60 m) and upsample.**
- Consequences of these simplifications:
  - the hypothetical spread ignores fire–atmosphere feedback, so the DMZ is *underestimated* in plume-dominated conditions (show "at least" wording);
  - Tobler is for hikers, not fatigued firefighters with tools (conservative factors);
  - junction and VLS effects are parameterised, not resolved (doc 02).

### 9.5 Scenario library (for instructors) [H]

Build each scenario on real NSW terrain with a synthetic ignition:

1. "Wind change on the flank": Linton-type, on Blue Mountains plateau terrain.
2. "Gully run": steep drainage off the Grose/Megalong escarpment, with afternoon anabatic flow.
3. "Mid-slope road trap".
4. "Lee-slope VLS": Brindabella-type, W wind.
5. "Night thermal belt" in Kanangra-Boyd.
6. "Morning inversion break": New England gorge.
7. "Backburn off a ridge-top fire trail, with a change due at 02:00".
8. "Junction slam".
9. "Spot fires behind the ridge".
10. "PyroCb day": high C-Haines, large fire.

Each should come with POE prompts and debrief cards.

---

## 10. Explaining it to a beginner firefighter

### 10.1 Writing rules for cards [H]

- 2–4 sentences, plain words, and "because" language. Name the *terrain feature they can see*: "this gully", "that saddle".
- One safety takeaway, always consistent with LACES and doctrine. Never "you are safe"; say "safer" or "less exposed".
- Show numbers only as supporting detail ("about ×4 faster than on flat ground") and always with "about".
- Show a confidence badge: **Physics** (well established), **Rule of thumb**, **Model estimate**.
- Show the source line under a "Learn more" expander.
- Final line on Danger cards: "Education only. LACES first. Follow your Crew Leader."

### 10.2 Common symbols used in triggers

- θ: slope (deg) at the fire-grid resolution; θ₂₅₀ is slope at 250 m smoothing.
- `upslope_dir`: the direction pointing uphill (aspect + 180°).
- `wind_to`: the direction the wind blows towards (meteorological direction + 180°).
- `∠(a,b)`: the smallest angle between two directions.
- `head_dir(c)`: the local spread direction at perimeter cell c.
- `crew`: user-placed crew or vehicle markers. `T_a`, `T_e` and `M` are as defined in §9.3.
- `FMC_d`: dead fine fuel moisture (%). `FH`: predicted flame height (m). `I`: intensity (kW/m). `R`: ROS (km/h).
- Time is local solar time; the conversion from AEDT or AEST is handled in code.

### 10.3 Insight card library (40 cards)

Thresholds tagged [H] are design choices for RFS instructors to tune. Published thresholds carry their source tag.

---

**S01 — Fire runs uphill** · Insight

- **Trigger:** perimeter cell with ∠(head_dir, upslope_dir) ≤ 45° and θ ≥ 10° [H].
- **Why:** On a slope, the flames lean toward the fuel above them and heat it before the fire arrives. Hot air also rushes up the slope face. On this slope of about {θ}°, the fire is spreading about ×{exp(0.069θ)} faster than it would on flat ground.
- **Safety:** Never position yourself upslope of a fire. Your escape route should not go uphill.
- **Source:** McArthur 1967; Noble et al. 1980 [L].

**S02 — Steep enough for the flames to "stick" to the slope** · Watch Out

- **Trigger:** fire heading upslope (∠ ≤ 30°) on θ ≥ 24° sustained over ≥ 100 m upslope run length [L threshold, H run length].
- **Why:** On very steep ground the flame stops rising away from the slope and lies down along it, like a blowtorch pointed uphill. Heating of the fuel ahead jumps sharply, and the fire can accelerate on its own without any wind change.
- **Safety:** Expect sudden runs on slopes this steep. Keep well clear above and beside it.
- **Source:** Wu et al. 2000; Viegas 2005; Dold & Zinoviev 2009 [L].

**S03 — Chimney / gully run** · Danger (if a crew is within 500 m above) / Watch Out

- **Trigger:** gully mask (TPI₁₅₀ ≤ −10 m, concave plan curvature, flow accumulation ≥ 5 ha [H]) with axial θ ≥ 20°. Fire within 200 m of the gully base. Wind within 45° of up-gully, or calm afternoon anabatic conditions [H]. Aligns with doc 02 card 11.
- **Why:** This steep gully works like a chimney. The fire's own heat pulls air up it and the sides radiate into each other, so fire can race up in minutes. Many firefighter deaths worldwide happened in or above gullies like this.
- **Safety:** Do not work in, above or at the head of a gully with fire below.
- **Source:** Viegas & Pita 2004; Wilson 1977; Butler et al. 1998 [L].

**S04 — Saddle ahead** · Watch Out

- **Trigger:** saddle point within 1 km of the head, in the direction of spread (∠ ≤ 45°), and ridge-level wind ≥ 15 km/h [H]. Also fires if a crew, vehicle or refuge is within 200 m of the saddle.
- **Why:** Wind squeezes through low points in a ridge and speeds up, and fire follows it through into the next valley. Saddles look like easy crossing points, but they are fire corridors.
- **Safety:** Don't park, rest or plan a refuge in a saddle.
- **Source:** widely taught terrain principle [L]; Sharples 2009 [L].

**S05 — Mid-slope road with fire below** · Danger if a crew is on the road

- **Trigger:** road or trail cell with cross-slope θ ≥ 15°, active fire within 500 m downslope, spreading upslope [H].
- **Why:** A fire below will run up to this road and keep going. The road has fuel above and below it, and smoke and heat can block both directions at once.
- **Safety:** Treat a mid-slope road as a trap when fire is below. Know which way out is downhill or into the black.
- **Source:** NWCG/AFAC terrain hazards [L].

**S06 — You are above the fire** · Danger

- **Trigger:** crew elevation more than 20 m above an active perimeter cell within 500 m horizontal distance, on slope θ₂₅₀ ≥ 10°, with that cell heading toward the crew (∠ ≤ 60°) [H]. Watch Out #9.
- **Why:** Fire spreads fastest uphill, and people move slowest uphill. From above, you often can't see the fire coming through the smoke and trees.
- **Safety:** Move so that you are beside or below the fire, or in the black. Downhill line construction needs a lookout, an anchor and an agreed escape route first.
- **Source:** NWCG 18 Watch Outs #9; Rothermel 1993; Butler et al. 1998 [L].

**S07 — Rolling embers and logs** · Watch Out

- **Trigger:** burning cells with θ ≥ 20° directly upslope of unburnt fuel, or of a control line, within 300 m [H]. Watch Out #13.
- **Why:** Burning bark, logs and cones roll downhill and can start new fires below you and below your control line.
- **Safety:** Patrol below the line. Don't stand in the path of material rolling off a burning slope.
- **Source:** NWCG 18 Watch Outs #13 [L].

**S08 — Fire reaching the ridge** · Watch Out

- **Trigger:** perimeter within 150 m of a ridge line (TPI₅₀₀ in the top 10% [H]), with ridge wind ≥ 15 km/h across the ridge [H].
- **Why:** At the ridge top the fire meets stronger wind, and embers are thrown over into the next valley. Fires often start on the far side of the ridge before the main fire arrives.
- **Safety:** If you are on the ridge or in the next valley, post a lookout facing the far side too.
- **Source:** Sharples 2009; doc 02 [L].

**S09 — Lee slope: fire can go sideways** · Danger / Watch Out

- **Trigger:** doc 02 VLS score > 0.5 (lee slope > 20–25°, aspect within 30–40° of downwind, ridge wind > ~20 km/h [V in doc 02]). Fire or spot fire within about 300 m of the crest [H].
- **Why:** The wind pouring over this ridge breaks away from the steep downwind slope and rolls into an eddy. Fire getting into that eddy can be dragged sideways along the slope, across the wind, while throwing embers far ahead. This is how small fires suddenly become very wide.
- **Safety:** Don't assume the flanks are safe on lee slopes.
- **Source:** Sharples et al. 2012; Simpson et al. 2013 [L]; doc 02 [V].

**S10 — Strong wind can push fire downhill** · Watch Out

- **Trigger:** downslope wind component ≥ 25 km/h at 10 m (∠(wind_to, −upslope_dir) ≤ 45°), with θ ≥ 10° and FMC_d ≤ 8% [H].
- **Why:** Fire normally creeps slowly downhill. A strong wind blowing down the slope overrides that, and the fire can run downhill fast, especially in foehn-type winds off the ranges.
- **Safety:** "Fire doesn't go downhill" is not a safe rule. Check the wind direction relative to the slope.
- **Source:** Sharples 2009 [L]; doc 02.

**S11 — Wind change coming: the flank will become the head** · Danger

- **Trigger:** forecast or user-set wind direction change ≥ 45° with post-change speed ≥ 15 km/h within the next 3 h [H]. A countdown is shown. The card names the exposed flank and its length.
- **Why:** When the wind swings, the whole long side of this fire (about {L_flank} km) becomes the front. Because the new front is already wide, it runs at full speed almost at once. This is how the five Linton firefighters died in 1998.
- **Safety:** Everyone must know the change time. Move off the flank that will become the head, or into the black, before the change.
- **Source:** Cheney et al. 2001 [V]; Linton coroner 2002 [V]; Cheney & Gould 1995 [L].

**S12 — You are in the dead-man zone** · Danger

- **Trigger:** crew inside the DMZ polygon (§9.3), i.e. would be reached within 5 min of the forecast or worst-case change, and not within 20 m [H] of well-burnt black.
- **Why:** If the wind changed now, fire could reach you in under five minutes: {T} min by the model. That is not enough time to reach a refuge unless you are right next to burnt ground.
- **Safety:** Work close to the black, or move out of the zone. Keep your escape short and downhill or sideways.
- **Source:** Cheney, Gould & McCaw 2001 [V].

**S13 — Hot, dry and windy ahead of the front** · Watch Out

- **Trigger:** forecast NW–W sector wind ≥ 30 km/h with RH ≤ 20% and T ≥ 32 °C, or AFDRS rating ≥ Extreme [H; the AFDRS categories are L].
- **Why:** Before a cold front, NSW gets hot, dry north-westerly winds that dry the leaf litter to a crisp. The fire will be at its most aggressive just before the change, and then the change swings it.
- **Safety:** Plan both for the run now and for the change later.
- **Source:** Mills 2008; Sharples 2009 [L].

**S14 — Afternoon peak** · Insight

- **Trigger:** local solar time between 13:00 and 17:00, with the simulated FMC_d at or near its daily minimum (within 1 percentage point) [H]. Also covers Watch Out #14 (hotter and drier trend).
- **Why:** Leaf litter is driest and the air hottest and driest in mid-to-late afternoon. Winds blow up the slopes most strongly now. North- and west-facing slopes are the driest of all.
- **Safety:** Expect the biggest runs now. Don't be lulled by a quiet morning.
- **Source:** Sharples 2009; Whiteman 2000 [L]; Page et al. 2019 [L].

**S15 — Morning inversion about to break** · Watch Out

- **Trigger:** atmosphere model shows a surface-based inversion in the valley (dθ/dz > 0 in the lowest 200 m [H]) after sunrise, with mixed-layer growth predicted to exceed the valley depth within 60 min [H].
- **Why:** Overnight, cold air pooled in the valley like a lid and kept the fire and smoke down. When the sun breaks the lid, the stronger, drier wind above mixes down and the fire can wake up very quickly.
- **Safety:** A quiet smoky morning is not a safe morning. Re-check escape routes before mid-morning.
- **Source:** Whiteman 2000; Sharples 2009 [L]; doc 02 §2.4.

**S16 — Night thermal belt** · Insight

- **Trigger:** night (sun elevation < 0°), with fire in a mid-slope band where the simulated T is ≥ 2 °C warmer and RH ≥ 10 points lower than the valley floor [H].
- **Why:** At night cold air sinks into the valley, but the middle of the slope can stay warmer and drier than both the valley and the ridge top. Fires in this band can keep burning actively all night.
- **Safety:** Night doesn't always mean quiet. Expect activity on mid-slopes.
- **Source:** Hayes 1941; Whiteman 2000 [L]; doc 02.

**S17 — Evening wind flip** · Insight

- **Trigger:** within 90 min of sunset, simulated near-surface slope or valley wind direction reverses by ≥ 90° [H].
- **Why:** During the day, warm air flows up the slopes and valleys. After sunset it cools and drains down them instead. The fire's direction can change even though the forecast wind hasn't.
- **Safety:** Re-check which side of the fire is "the head" at dusk.
- **Source:** Whiteman 2000 [L]; doc 02 §2.3.

**S18 — Sunny-side slope** · Insight

- **Trigger:** fire spreading onto a slope with aspect between 300° and 60° (N-facing) or 240°–300° in the afternoon (W-facing), with simulated FMC_d at least 1.5 percentage points lower than on the opposite aspect [H].
- **Why:** In Australia, north- and west-facing slopes get the most sun. Their leaf litter is drier and the bush often more open and flammable, so the fire speeds up when it crosses onto them.
- **Safety:** Expect the fire to pick up as it moves onto sunny slopes, especially in the afternoon.
- **Source:** Hayes 1941 (principle) [L]; fuel moisture model (doc on fuels).

**S19 — Spot fires across the line** · Danger

- **Trigger:** at least 2 simulated spot ignitions across a user control line within 30 simulated minutes, or at least 1 within 200 m of a crew [H]. Watch Out #16.
- **Why:** Embers are landing across your line and starting new fires. The fire is now effectively on both sides of you, and spot fires grow and join up quickly.
- **Safety:** Tell your Crew Leader. Lookouts must watch behind the line. Be ready to move.
- **Source:** NWCG 18 Watch Outs #16 [L]; Ellis 2015 [L].

**S20 — Long-range embers** · Watch Out

- **Trigger:** simulated ember landings ≥ 1 km ahead of the head, or bark fuel hazard ≥ High (stringybark/ribbon bark) with 10-m wind ≥ 30 km/h and FMC_d ≤ 7% [H].
- **Why:** Stringybark and ribbon bark peel off in burning strips that the wind and smoke column can carry for kilometres. New fires can start well ahead of the main front, including on the other side of valleys.
- **Safety:** Your location may be "ahead of the fire" even if the main edge is far away. Watch for smoke behind you.
- **Source:** Ellis 2011; Storey et al. 2020; Cruz et al. 2012 [L].

**S21 — Unburnt fuel between you and the fire** · Watch Out

- **Trigger:** crew with fuel load ≥ 5 t/ha [H] between them and the nearest active perimeter, and not in the black. Watch Out #11.
- **Why:** Fuel between you and the fire can ignite and cut you off, or burn toward you. The black is behind the fire edge, not in front of it.
- **Safety:** Where the fire is low enough to allow it, work from the burnt side.
- **Source:** NWCG 18 Watch Outs #11 [L]; Cheney et al. 2001 [V].

**S22 — Leaf litter is bone dry** · Watch Out

- **Trigger:** simulated or observed FMC_d ≤ 6% [H; within the Vesta moisture-function range, L].
- **Why:** Leaf litter this dry catches from a single ember and lets fire spread fast even in light wind. Spot fires will take off almost as soon as they land.
- **Safety:** Expect many spot fires and fast growth. Treat any ember as a new fire.
- **Source:** Gould et al. 2007; Ellis 2015 [L].

**S23 — Tall understorey: flames will get taller** · Insight

- **Trigger:** fire entering cells with elevated-fuel hazard ≥ High (OFHAG), or where the user has increased the understorey [H].
- **Why:** Shrubs and bark act as a ladder. Flames climb them and get much taller and hotter than in leaf litter alone, which makes the fire harder to stop and more likely to reach the treetops.
- **Safety:** Taller flames mean a bigger safety refuge. The refuge must be clear for at least four times the flame height.
- **Source:** Hines et al. 2010; Gould et al. 2007 [L]; LACES [V].

**S24 — The fire is climbing into the treetops** · Danger

- **Trigger:** surface I ≥ I₀ (Van Wagner, §4.6), or the spread model reports canopy involvement, and I ≥ 4,000 kW/m [L band].
- **Why:** The fire is now hot enough to set the tree canopy alight. Crown fire spreads faster, throws far more embers and cannot be stopped by crews on the ground.
- **Safety:** Direct attack is not possible. Go to your safety refuge or the black, and let the Crew Leader decide on indirect tactics.
- **Source:** Van Wagner 1977; suppression bands [L].

**S25 — The fire is making its own wind** · Watch Out

- **Trigger:** N_c ≥ 10 [L threshold, uncertain] over ≥ 200 m of front, or simulated plume updraft ≥ 5 m/s at 500 m above ground level [H].
- **Why:** This fire is releasing so much heat that its smoke column rises straight up and sucks air in from all sides. Its spread depends less on the forecast wind and can change direction suddenly.
- **Safety:** Expect erratic behaviour and winds blowing toward the fire. Stay near your refuge.
- **Source:** Byram 1959; Morvan & Frangieh 2018 [L].

**S26 — Smoke column collapse: sudden winds** · Danger

- **Trigger:** simulated plume-top descent, or a downdraft ≥ 3 m/s reaching the surface within 2 km, or the user reports a "collapsing" column [H].
- **Why:** When a big smoke column collapses, cooled air crashes to the ground and spreads out in all directions. The fire can suddenly be pushed toward you from a new direction, as happened at Yarnell Hill in 2013.
- **Safety:** Get to your refuge or the black immediately. Don't try to finish the task.
- **Source:** Forthofer & Goodrick 2011 [L]; Yarnell Hill investigation [L].

**S27 — PyroCb (fire thunderstorm) possible** · Danger

- **Trigger:** doc 02 criteria (C-Haines ≥ 10 or above the local 95th percentile, and simulated firepower > PFT), or the user reports a white cap or anvil on the column [H/V per doc 02].
- **Why:** The air above is unstable. This fire may build its own thunderstorm, bringing violent gusts, downdrafts, lightning, fire tornadoes and embers carried many kilometres. The Jingellic tanker was overturned by fire-generated winds in 2019.
- **Safety:** Crews should be in safe areas before this happens. Vehicles are not safe from these winds.
- **Source:** Fromm et al. 2006; McRae et al. 2015; Tory & Kepert 2021 [L]; doc 02.

**S28 — Fire whirl** · Watch Out

- **Trigger:** simulated vertical vorticity |ζ| ≥ 0.1 s⁻¹ at the fire grid near the perimeter [H]. Or a lee-slope VLS score > 0.5 with an active fire edge; or two fire edges meeting.
- **Why:** Spinning wind combined with the fire's heat can form a burning whirlwind. It can move erratically, fling embers and knock things over.
- **Safety:** Keep clear. Whirls often form behind ridges and where fire lines meet.
- **Source:** Forthofer & Goodrick 2011; McRae et al. 2013 [L].

**S29 — Junction zone: two fire lines meeting** · Danger

- **Trigger:** two active perimeter segments (main fire and backburn, or two spot fires) converging with an included angle α ≤ 45° and a gap ≤ 300 m [H]. The speed-up factor 1/sin(α/2) is shown.
- **Why:** Where two fires meet at a sharp angle, the point where they join races forward, about {1/sin(α/2)}× faster by geometry alone, and faster again because the two fires feed each other's heat and wind. The pocket between them can burn out violently.
- **Safety:** Never be in the unburnt pocket between two fires.
- **Source:** Viegas et al. 2012; Raposo et al. 2018 [L]; geometry [D].

**S30 — Backburn race against the change** · Danger

- **Trigger:** active user backburn, with the forecast wind change arriving before the model's predicted completion and securing of the backburn (black depth ≥ 100 m [H] along the whole line).
- **Why:** A backburn that isn't finished when the wind changes becomes a new fire front with its own flank. The change can turn it back over your control line.
- **Safety:** Backburns must be completed and secured well before the change. Stop lighting if you can't finish.
- **Source:** NSW RFS Prescribed Burning OPG (LACES) [V]; backburning principles [L].

**S31 — Lighting below yourself** · Danger

- **Trigger:** backburn ignition line more than 10 m lower than any crew within 300 m horizontal, on θ₂₅₀ ≥ 10° [H]; or ignition at the base of a gully that leads toward the line or crews.
- **Why:** Fire lit below you will run uphill toward you. Backburns in hills are lit from the top so they creep down the slope slowly.
- **Safety:** Light from the top of the slope. Never light below crews.
- **Source:** Backburning principles [L]; S01.

**S32 — This refuge is too small** · Danger

- **Trigger:** refuge clear distance in the fire-approach direction < 4 × predicted FH [V doctrine]. Or it passes 4× but is on θ ≥ 15° or in 10-m wind ≥ 20 km/h, where SSD is greater [L/H].
- **Why:** To be safe from the heat you need clear ground of at least four times the flame height between you and the fire. With about {FH} m flames that is {4·FH} m, and more on slopes and in wind, because hot gases are pushed toward you.
- **Safety:** Find a bigger clearing, a road junction, rock or well-burnt ground. Tell your Crew Leader.
- **Source:** NSW RFS / AFAC LACES [V]; Butler & Cohen 1998; Page & Butler 2017 [L].

**S33 — You can't outrun it uphill** · Danger

- **Trigger:** T_a(crew) < T_e + M along the chosen escape route (§9.3), or the route climbs more than 30 m toward fire-exposed ground [H]. Watch Out #17.
- **Why:** On this {θ}° slope, walking uphill with gear is only about {v} km/h. The fire is predicted to climb at about {R} km/h. The fire wins.
- **Safety:** Escape routes should go downhill, sideways or into the black, and be short enough to jog.
- **Source:** Tobler 1993; Campbell et al. 2017 [L]; LACES [V]; §4.8 [D].

**S34 — Trigger point reached: leave now** · Danger

- **Trigger:** the active perimeter crosses the trigger contour for any crew (§9.3).
- **Why:** The fire has reached the point where the time left, by the model, is only just enough for you to walk out to your refuge with a safety margin. Waiting longer uses up that margin.
- **Safety:** Move now, calmly, along the planned route.
- **Source:** Cova et al. 2005; Fryer et al. 2013 [L].

**S35 — Smoke turned dark** · Insight

- **Trigger:** the user reports a white-to-black change, or the model shows a fuel-consumption or crowning jump (I increases ×3 within 10 min) [H].
- **Why:** Darker, thicker smoke usually means the fire has moved into heavier fuel or is burning hotter, often climbing into shrubs or treetops. White smoke is more often light, moist fuel.
- **Safety:** Treat a sudden colour change as a warning to look again and tell your Crew Leader. It is a clue, not a measurement.
- **Source:** widely taught smoke-reading heuristic [L].

**S36 — "Innocent-looking" fire** · Insight

- **Trigger:** low current intensity (I < 500 kW/m) in grass or light fuels, but a forecast change or rising wind within 2 h, or θ ≥ 15° uphill of the fire [H].
- **Why:** Most firefighter deaths happened on small or quiet-looking fires in light fuels, just before the wind changed or the fire hit a steep slope. Grass and light scrub react to wind almost instantly.
- **Safety:** Quiet now does not mean safe soon. Keep LACES in place.
- **Source:** Wilson 1977 [L].

**S37 — No one can see the head** · Watch Out

- **Trigger:** viewshed from the crews and lookouts covers less than 20% of the active head-fire cells [H]. Watch Out #12.
- **Why:** From here the trees, ridges and smoke hide the front of the fire. If it changes, no one will see it coming in time.
- **Safety:** Post a lookout who can see both the fire and you, and agree a signal.
- **Source:** LACES [V]; NWCG 18 Watch Outs #12 [L].

**S38 — Forces aligned** · Watch Out (at 3 of 3) / Insight (at 2 of 3)

- **Trigger:** count of the forces aligned with head_dir, each within 45° [H]: (i) wind_to; (ii) upslope_dir with θ ≥ 10°; (iii) sun-facing aspect in the afternoon, or fuel moisture lower ahead than behind.
- **Why:** Right now wind, slope and sun are all pushing the fire the same way. When all three line up, fires make their biggest runs. When they oppose each other, the fire slows.
- **Safety:** Look at the map: where will these three line up next? That is where the fire will run.
- **Source:** Campbell 1995 [L].

**S39 — This area burned recently** · Insight

- **Trigger:** fire approaching a polygon with time since fire or hazard-reduction burn ≤ 5 years [H], per user input or the fire-history layer.
- **Why:** This area burned {n} years ago, so there is less leaf litter and understorey. The fire should slow down and burn lower here. It can be a good anchor or refuge, but it won't stop embers.
- **Safety:** Use recently burnt ground to your advantage, but check it for hazard trees and unburnt patches.
- **Source:** Olson 1963; fuel accumulation [L].

**S40 — The black isn't always safe** · Watch Out

- **Trigger:** crew in black that is less than 60 min old in forest (canopy cover ≥ 30%), where the spread model shows the canopy unburnt or partially burnt, or where the refuge is under trees [H].
- **Why:** In forests, burnt ground can still re-burn if the treetops or patches didn't burn. Fire-weakened trees can fall without warning, as they did at Green Wattle Creek in 2019.
- **Safety:** Choose well-burnt, open black away from standing dead trees. Look up. Keep two tree-lengths from burning trees.
- **Source:** hazard-tree practice [L]; Green Wattle Creek (2019) [L].

---

## 11. Open questions, uncertainties and verification checklist

1. **Doctrine wording.** The full text of the NSW RFS *Bush and Forest Fires*, *Safety Refuges from Bush and Grass Fires* and *Fundamental Protocols* could not be read. Only the LACES text in the Prescribed Burning protocol was verified [V]. An NSW RFS instructor must review all card safety takeaways against current doctrine.
2. **Dead-man zone paper.** Only the abstract and secondary summaries were read. Before quoting in-app, verify in the PDF: the "five minutes" definition; the "600 m h⁻¹ in under three minutes" Vesta statement; the "<100 m to >1 km" range; and the list of case studies.
3. **Case-study facts.** Check against coronial findings before in-app use:
   - Ash Wednesday / Upper Beaconsfield (count and wind-change detail);
   - Black Saturday (change timing, flank width, maximum spotting distance);
   - Green Wattle Creek (sequence: tree strike versus rollover);
   - Jingellic (vortex versus downdraft attribution).

   Sensitivity: use a respectful memorial tone and avoid graphic detail. Recommend family- and agency-sensitive framing.
4. **SSD slope-wind factor table** (IRPG PMS 461): copy the exact values; they were deliberately not reproduced here.
5. **Suppression-difficulty intensity bands:** confirm the exact Australian source (e.g. the Vesta field guide or AFAC training material) and the values.
6. **N_c regime thresholds** and the reference wind height are uncertain.
7. **Smoke-colour heuristics** have little quantitative validation. Keep them in "clue, not measurement" form.
8. **Evidence on training outcomes:** no rigorous evaluation of sand-table or simulation training outcomes for wildland firefighters was retrieved. FireSim could collect pre/post POE scores (with consent) to generate this evidence.
9. **Tobler for firefighters:** the load and fatigue factors are heuristic. Campbell et al. (2017) coefficients were not verified.
10. **Night thermal-belt and inversion-break thresholds** depend on the atmosphere model's skill at 100–200 m resolution. See doc 02 on resolution limits.
11. **Mountain wind-change arrival:** there is no quantitative literature on terrain-induced timing differences of fronts in NSW valleys; treat it qualitatively.
12. **AFDRS FBI bands** and their mapping to intensity for forest fuels must be verified from the AFDRS technical documentation.
13. **Cliff-line / sandstone escarpment behaviour** (Blue Mountains) is a gap in the retrieved literature.

---

## 12. References

Session evidence: **[V]** marks items seen in this session's search results. All others are [L] and must be verified.

**Doctrine and training**
- AFAC. *Use of Lookouts, Awareness, Communications, Escape Routes, Safety Zones (LACES) system for safety on the fireground.* https://www.afac.com.au/resources/use-of-lookouts--awareness--communications--escape-routes--safety-zones--laces--system-for-safety-on-the-fireground [V]
- NSW RFS. *Prescribed Burning Activities General Operational Protocol.* https://www.rfs.nsw.gov.au/__data/assets/pdf_file/0007/245851/RFS-OPG-Prescribed-Burning.pdf [V]
- NSW RFS. Foundational doctrine: *Bush and Forest Fires*, https://www.rfs.nsw.gov.au/resources/publications/doctrine/foundational/bush-and-forest-fires ; *Grass and Crop Fires*, https://www.rfs.nsw.gov.au/resources/publications/doctrine/foundational/grass-and-crop-fires ; *Safety Refuges from Bush and Grass Fires*, https://www.rfs.nsw.gov.au/resources/publications/doctrine/foundational/safety-refuges-from-bush-and-grass-fires ; *Fundamental Protocol 2*, https://www.rfs.nsw.gov.au/resources/publications/doctrine/fundamental-protocols/fundamental-protocol-2 [V existence]
- NWCG. *10 Standard Firefighting Orders*, PMS 110: https://www.nwcg.gov/publications/pms110/10-standard-firefighting-orders-pms-110 ; *18 Watch Out Situations*, PMS 118: http://www.nwcg.gov/publications/pms118/18-watch-out-situations-pms-118 ; *10 and 18 Poster*, PMS 110-18: https://fs-prod-nwcg.s3.us-gov-west-1.amazonaws.com/s3fs-public/2023-06/pms110-18.pdf ; *Origin of the 10 and 18 – June 17, 1957*: https://www.nwcg.gov/6mfs/day-in-history/origin-of-the-10-and-18-june-17-1957 [V]
- NWCG. *Incident Response Pocket Guide* (PMS 461), current edition, for the downhill line checklist and SSD table. https://www.nwcg.gov/publications/pms461 [L]
- Gleason P. *Lookouts, Communication, Escape Routes and Safety Zones "LCES".* https://fs-dev-nwcg.s3.us-gov-west-1.amazonaws.com/s3fs-public/2023-06/lces-gleason.pdf [V existence]
- Wilson CC (1977) Fatal and near-fatal forest fires: the common denominators. *International Fire Chief* 43(9):9–15. [L]
- Campbell D (1995) *The Campbell Prediction System: A Wild Land Fire Prediction System & Language*. 2nd edn, self-published, Ojai CA. [L]

**Dead-man zone, wind change and case studies**
- Cheney NP, Gould JS, McCaw L (2001) The dead-man zone – a neglected area of firefighter safety. *Australian Forestry* 64(1):45–50. https://doi.org/10.1080/00049158.2001.10676160 [V]; ResearchGate: https://www.researchgate.net/publication/237695247 [V]
- "Dead man zone", Wikipedia (secondary summary). https://en.wikipedia.org/wiki/Dead_man_zone [V, secondary]
- Cheney NP, Gould JS (1995) Fire growth in grassland fuels. *IJWF* 5(4):237–247. https://doi.org/10.1071/WF9950237 [L]
- State Coroner Victoria (2002) *Report of the Investigation and Inquests into a Wildfire and the Deaths of Five Firefighters at Linton on 2 December 1998.* https://www.ffm.vic.gov.au/__data/assets/pdf_file/0031/526594/Report-of-the-Investigation-and-Inquests-into-a-Wildfire-and-the-Deaths-of-Five-Firefighters-at-Linton.pdf [V]; The Courier, "Linton inquest findings": https://www.thecourier.com.au/story/323255/linton-inquest-findings/ [V]
- SA Coroner. *Inquest into the deaths of Star Ellen Borlase, Jack Morley Borlase, … (Wangary bushfire) – findings summary.* https://safecom-files-v8.s3.amazonaws.com/current/docs/wangary_bushfire_findings_summary.pdf [V]; ABC News (2025) "SA's Wangary 2005 bushfire rewrote the record book": https://www.abc.net.au/news/2025-01-11/wangary-grassfire-20-year-anniversary/104806782 [V]; Geoscience Australia, *Eyre Peninsula Bushfire Fieldwork 10 January 2005*: https://www.ga.gov.au/bigobj/GA9582.pdf [V]
- Cruz MG, Sullivan AL, Gould JS, Sims NC, Bannister AJ, Hollis JJ, Hurley RJ (2012) Anatomy of a catastrophic wildfire: the Black Saturday Kilmore East fire in Victoria, Australia. *Forest Ecology and Management* 284:269–285. https://doi.org/10.1016/j.foreco.2012.02.035 [L]
- Teague B, McLeod R, Pascoe S (2010) *2009 Victorian Bushfires Royal Commission Final Report.* Parliament of Victoria. [L]
- Owens D, O'Kane M (2020) *Final Report of the NSW Bushfire Inquiry.* NSW Government. [L]
- Rothermel RC (1993) *Mann Gulch Fire: A Race That Couldn't Be Won.* USDA FS GTR INT-299. [L]
- Butler BW, Bartlette RA, Bradshaw LS, Cohen JD, Andrews PL, Putnam T, Mangan RJ (1998) *Fire Behavior Associated with the 1994 South Canyon Fire on Storm King Mountain, Colorado.* USDA FS RMRS-RP-9. [L]
- Page WG, Freeborn PH, Butler BW, Jolly WM (2019) A review of US wildland firefighter entrapments: trends, important environmental factors and research needs. *IJWF* 28(8):551–569. https://doi.org/10.1071/WF19022 [L]
- Blanchi R, Leonard J, Haynes K, Opie K, James M, Dimer de Oliveira F (2014) Environmental circumstances surrounding bushfire fatalities in Australia 1901–2011. *Environmental Science & Policy* 37:192–203. [L]

**Safety zones, escape and triggers**
- Butler BW, Cohen JD (1998) Firefighter safety zones: a theoretical model based on radiative heating. *IJWF* 8(2):73–77. https://doi.org/10.1071/WF9980073 [L]
- Butler BW (2014) Wildland firefighter safety zones: a review of past science and summary of future needs. *IJWF* 23(3):295–308. https://doi.org/10.1071/WF13021 [V existence]
- Page WG, Butler BW (2017) An empirically based approach to defining wildland firefighter safety and survival zone separation distances. *IJWF* 26(8):655–667. https://doi.org/10.1071/WF16213 [L]
- Campbell MJ, Dennison PE, Butler BW (2017) A LiDAR-based analysis of the effects of slope, vegetation density, and ground surface roughness on travel rates for wildland firefighter escape route mapping. *IJWF* 26(10):884–895. https://doi.org/10.1071/WF17031 [L]
- Tobler W (1993) *Three Presentations on Geographical Analysis and Modeling.* NCGIA Technical Report 93-1. [L]
- Cova TJ, Dennison PE, Kim TH, Moritz MA (2005) Setting wildfire evacuation trigger points using fire spread modeling and GIS. *Transactions in GIS* 9(4):603–617. [L]
- Fryer GK, Dennison PE, Cova TJ (2013) Wildland firefighter entrapment avoidance: modelling evacuation triggers. *IJWF* 22(7):883–893. https://doi.org/10.1071/WF12160 [L]
- Budd GM et al. (1997) Project Aquarius (series of papers on the physiology of bushfire suppression). *IJWF* 7(2):69–218. [L]

**Fire behaviour and terrain**
- McArthur AG (1967) *Fire Behaviour in Eucalypt Forests.* Forestry and Timber Bureau Leaflet 107, Canberra. [L]
- Noble IR, Bary GAV, Gill AM (1980) McArthur's fire-danger meters expressed as equations. *Australian Journal of Ecology* 5:201–203. https://doi.org/10.1111/j.1442-9993.1980.tb01243.x [L]
- Byram GM (1959) Combustion of forest fuels. In Davis KP (ed.) *Forest Fire: Control and Use*, McGraw-Hill, pp. 61–89. [L]
- Gould JS, McCaw WL, Cheney NP, Ellis PF, Knight IK, Sullivan AL (2007) *Project Vesta – Fire in Dry Eucalypt Forest: Fuel Structure, Fuel Dynamics and Fire Behaviour.* Ensis-CSIRO and Dept of Environment and Conservation WA. [L]
- Cheney NP, Gould JS, McCaw WL, Anderson WR (2012) Predicting fire behaviour in dry eucalypt forest in southern Australia. *Forest Ecology and Management* 280:120–131. https://doi.org/10.1016/j.foreco.2012.06.012 [L]
- Van Wagner CE (1977) Conditions for the start and spread of crown fire. *Canadian Journal of Forest Research* 7:23–34. https://doi.org/10.1139/x77-004 [L]
- Wu Y, Xing HJ, Atkinson G (2000) Interaction of fire plume with inclined surface. *Fire Safety Journal* 35:391–403. [L]
- Viegas DX, Pita LP (2004) Fire spread in canyons. *IJWF* 13(3):253–274. https://doi.org/10.1071/WF03050 [L]
- Viegas DX (2005) A mathematical model for forest fires blowup. *Combustion Science and Technology* 177(1):27–51. [L]
- Dold JW, Zinoviev A (2009) Fire eruption through intensity and spread rate interaction mediated by flow attachment. *Combustion Theory and Modelling* 13(5):763–793. https://doi.org/10.1080/13647830902977570 [L]
- Viegas DX, Raposo JR, Davim DA, Rossa CG (2012) Study of the jump fire produced by the interaction of two oblique fire fronts. Part 1. *IJWF* 21(7):843–856. https://doi.org/10.1071/WF10155 [L]
- Raposo JR, Viegas DX, Xie X, Almeida M, Figueiredo AR, Porto L, Sharples J (2018) Analysis of the physical processes associated with junction fires at laboratory and field scales. *IJWF* 27(1):52–68. https://doi.org/10.1071/WF16173 [L]
- Hines F, Tolhurst KG, Wilson AAG, McCarthy GJ (2010) *Overall Fuel Hazard Assessment Guide*, 4th edn. Fire and Adaptive Management Report 82, DSE Victoria. [L]
- Olson JS (1963) Energy storage and the balance of producers and decomposers in ecological systems. *Ecology* 44:322–331. [L]
- Ellis PFM (2011) Fuelbed ignition potential and bark morphology explain the notoriety of the eucalypt messmate "stringybark" for intense spotting. *IJWF* 20(7):897–907. https://doi.org/10.1071/WF10052 [L]
- Ellis PFM (2015) The likelihood of ignition of dry-eucalypt forest litter by firebrands. *IJWF* 24(2):225–235. [L]
- Storey MA, Price OF, Sharples JJ, Bradstock RA (2020) Drivers of long-distance spotting during wildfires in south-eastern Australia. *IJWF* 29(6):459–472. https://doi.org/10.1071/WF19124 [L]
- Morvan D, Frangieh N (2018) Wildland fires behaviour: wind effect versus Byram's convective number and consequences upon the regime of propagation. *IJWF* 27(9):636–641. https://doi.org/10.1071/WF18014 [L]
- Forthofer JM, Goodrick SL (2011) Review of vortices in wildland fire. *Journal of Combustion* 2011:984363. https://doi.org/10.1155/2011/984363 [L]

**Mountain meteorology and pyroconvection** (details in doc 02)
- Sharples JJ (2009) An overview of mountain meteorological effects relevant to fire behaviour and bushfire risk. *IJWF* 18(7):737–754. https://doi.org/10.1071/WF08041 [L]
- Sharples JJ, McRae RHD, Wilkes SR (2012) Wind–terrain effects on the propagation of wildfires in rugged terrain: fire channelling. *IJWF* 21(3):282–296. https://doi.org/10.1071/WF10055 [L]
- Simpson CC, Sharples JJ, Evans JP, McCabe MF (2013) Large eddy simulation of atypical wildland fire spread on leeward slopes. *IJWF* 22(5):599–614. https://doi.org/10.1071/WF12072 [L]
- Hayes GL (1941) *Influence of Altitude and Aspect on Daily Variations in Factors of Forest-Fire Danger.* USDA Circular 591. [L]
- Whiteman CD (2000) *Mountain Meteorology: Fundamentals and Applications.* Oxford University Press. [L]
- Mills GA (2008) Abrupt surface drying and fire weather Part 2: a preliminary synoptic climatology in the forested areas of southern Australia. *Australian Meteorological Magazine* 57:311–328. [L]
- Mills GA, McCaw L (2010) *Atmospheric Stability Environments and Fire Weather in Australia – Extending the Haines Index.* CAWCR Technical Report 20. [L]
- Fromm M, Tupper A, Rosenfeld D, Servranckx R, McRae R (2006) Violent pyro-convective storm devastates Australia's capital and pollutes the stratosphere. *Geophysical Research Letters* 33:L05815. https://doi.org/10.1029/2005GL025161 [L]
- McRae RHD, Sharples JJ, Wilkes SR, Walker A (2013) An Australian pyro-tornadogenesis event. *Natural Hazards* 65:1801–1811. https://doi.org/10.1007/s11069-012-0443-7 [L]
- McRae RHD, Sharples JJ, Fromm M (2015) Linking local wildfire dynamics to pyroCb development. *Natural Hazards and Earth System Sciences* 15:417–428. https://doi.org/10.5194/nhess-15-417-2015 [L]
- Tory KJ, Kepert JD (2021) Pyrocumulonimbus firepower threshold: assessing the atmospheric potential for pyroCb. *Weather and Forecasting* 36(2):439–456. https://doi.org/10.1175/WAF-D-20-0027.1 [L]
- Peterson DA et al. (2021) Australia's Black Summer pyrocumulonimbus super outbreak reveals potential for increasingly extreme stratospheric smoke events. *npj Climate and Atmospheric Science* 4:38. https://doi.org/10.1038/s41612-021-00192-9 [L]

**Learning science and decision making**
- Klein GA, Calderwood R, Clinton-Cirocco A (1986) Rapid decision making on the fire ground. *Proceedings of the Human Factors Society 30th Annual Meeting* 1:576–580. [L]
- Endsley MR (1995) Toward a theory of situation awareness in dynamic systems. *Human Factors* 37(1):32–64. [L]
- Brehmer B (1992) Dynamic decision making: human control of complex systems. *Acta Psychologica* 81:211–241. [L]
- White R, Gunstone R (1992) *Probing Understanding.* Falmer Press. [L]
- Cook DA, Hatala R, Brydges R, et al. (2011) Technology-enhanced simulation for health professions education: a systematic review and meta-analysis. *JAMA* 306(9):978–988. [L]
- McLennan J, Holgate AM, Omodei MM, Wearing AJ (2006) Decision making effectiveness in wildfire incident management teams. *Journal of Contingencies and Crisis Management* 14(1):27–37. [L]
