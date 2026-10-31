# FireSim — mountain bushfire trainer

FireSim is a phone app for **beginner bush firefighters in the mountains of NSW** (Blue Mountains, Kanangra, Wollemi,
Budawangs, Snowy Mountains, Warrumbungles…). It builds a 3-D model of the country around you, takes the weather
(live, a past day, the forecast, a designed preset, a historic fire day or your own belt weather kit readings), lets
you mark where the fire is, and runs a **coupled 3-D atmosphere + fire spread + ember simulation** on the phone. Then it
explains **why** the fire does what it does: why it runs up that slope, why that gully is a chimney, why the flank
becomes the head when the southerly arrives, where embers land.

> ## ⚠ Training aid only
> FireSim is an **education tool**. It is **not an operational prediction** and must never be used to make decisions
> on a fireground. Always follow your Incident Controller, your Crew Leader and NSW RFS procedures. Fire models are
> simplified and can be badly wrong, especially on steep slopes, in gullies and in extreme weather, where real fires
> are often faster than any model. **LACES first**: Lookouts, Awareness, Communications, Escape routes, Safety refuges.
> Every number in the app is a *model estimate*; every insight card ends with doctrine, never with the model.

What FireSim **is**: a way to *predict, then observe* — make a call about where the fire will go, play it forward,
and read the plain-language explanation of the mechanism (with the literature behind it).
What it **is not**: a replacement for Phoenix / Spark / FBAN products, a forecast of a real fire, a map of real
incidents, or a guarantee that anywhere is safe.

| | | | |
|---|---|---|---|
| ![Setup](docs/screenshots/01-setup.png) | ![Mark the fire](docs/screenshots/02-mark-fire.png) | ![3-D view](docs/screenshots/03-orbit.png) | ![Arrival isochrones](docs/screenshots/04-top-arrival.png) |
| Setup: demo site, preset weather | Mark the fire with the crosshair | 3-D view of the running fire | Top view, arrival-time overlay |
| ![Cross-section](docs/screenshots/05-cross-section.png) | ![Insights](docs/screenshots/06-insights.png) | ![Why here?](docs/screenshots/07-why-here.png) | ![Eye level](docs/screenshots/08-eye-level.png) |
| The air slice's curtain (retaken for 0.4.0: it now has colour chips and also works on the fast tier) | Insight cards | "Why here?" explanation | Eye level from a lookout |
| ![Menus](docs/screenshots/09-menus-open.png) | ![Timeline jump](docs/screenshots/10-timeline-jump.png) | ![Speed](docs/screenshots/11-speed-popover.png) | |
| The two round menus, expanded (tools, view; the Tools list gained Air slices in 0.4.0) | A jump far ahead computing, with Cancel | Playback speed options | |

The screenshots above are produced by the end-to-end test `e2e/app.spec.ts` (Pixel 7 profile, the real engine). The new screens
below come from `e2e/gallery.spec.ts` (the same build, in light, night and high-contrast looks) and are 412 x 839 CSS pixels.

| | | | |
|---|---|---|---|
| ![The run](docs/screenshots/23-sim.png) | ![Layers panel](docs/screenshots/18-layers-panel.png) | ![A heat map on its own](docs/screenshots/19-layers-heat-map.png) | ![Roads, trails, homes, zones, names](docs/screenshots/21-places.png) |
| The run in the flat look: floating top pill, round map buttons, Tools, bottom navigation | Layers: map type, then a switch for every kind of map detail | One data layer as a heat map, on its own, with its legend | Roads, fire trails, homes, residential zones and place names to find yourself |
| ![Trees coded by bark](docs/screenshots/22-trees-coded.png) | ![Where you are](docs/screenshots/24-where-you-are.png) | ![Data sets](docs/screenshots/14-datasets-summary.png) | ![The list of data sets](docs/screenshots/15-datasets-list.png) |
| Trees colour-coded by bark (ember) hazard | "Why here?" also says where you are: nearest road and trail, homes, the ground | Data sets: size, origin and age of everything the model was built from | One row per data set, with its origin and size |
| ![A data set](docs/screenshots/16-datasets-detail.png) | ![Storage](docs/screenshots/17-datasets-storage.png) | ![How this simulation works](docs/screenshots/12-model-card.png) | ![The live engine rows](docs/screenshots/13-model-card-live.png) |
| One data set: source, licence, resolution, trust | What the app keeps on the phone; deletions always ask first | How this simulation works: what is 2-D, what is 3-D | The live summary (tier, speed, memory, this phone) and a way into all the numbers |
| ![Night](docs/screenshots/23-sim-dark.png) | ![High contrast](docs/screenshots/23-sim-high-contrast.png) | ![200 % text](docs/screenshots/25-font-scale-200.png) | ![Planned data in Setup](docs/screenshots/26-setup-data.png) |
| The night look | High contrast ("bright sun") | Android's 200 % font scale | Setup plans the data before anything is downloaded |
| ![A pasted Google Maps link](docs/screenshots/27-maps-link.png) | | | |
| Setup: a pasted Google Maps link becomes a place, with its name and whether the app has data for it | | | |

The pictures of 0.3.0 are in the same spec: the debug statistics screen in the first test, the others in the three tests whose names
start with "gallery 0.3.0" (the speed sheet, Why here? with an icon row and Settings, the night look, and an escarpment close-up).

| | | | |
|---|---|---|---|
| ![Simulation debug statistics](docs/screenshots/13b-debug-stats.png) | ![The speed sheet](docs/screenshots/28-pace-sheet.png) | ![Why here? with an icon row](docs/screenshots/29-why-here-icon.png) | ![Settings with Picture quality](docs/screenshots/30-settings-picture-quality.png) |
| Simulation debug statistics: the top of the page, with Copy as text and the groups collapsed | The speed sheet: why the simulation cannot keep up with the playback speed, and what to do | Why here? on an icon: the icon as the map draws it, its name and a line of detail | Settings: Performance and Picture quality, with their hints |
| ![Night lighting, Realistic](docs/screenshots/31-night-realistic.png) | ![Night lighting, Daylight](docs/screenshots/31b-night-daylight.png) | ![An escarpment close-up](docs/screenshots/32-escarpment-cliffs.png) | |
| Night lighting, Realistic: the real night | The same moment with Daylight: the ground lit from a fixed sun, the sky and the fire as before | An escarpment close-up on High: cliffs drawn as rock walls with ledges, joints, stains and scree (display only: every number uses the data as received) | |

Most new pictures also exist in `-dark` and `-high-contrast` versions in `docs/screenshots/` (of the 0.3.0 pictures, the statistics
screen has both, the speed sheet and Settings a `-dark` one, and the others are light only); the design system and the screens on
their own are in `docs/screenshots/design/` (`scripts/app-screenshots.mjs`).

The pictures of 0.4.0 (Air slices) are made by two more tests of the same spec, `gallery 0.4.0: the Air slices tool placing a line ...`
(33, 34 and 35) and `gallery 0.4.0: the side view on the fast model ...` (34b). They are written into `docs/screenshots/` when the pictures
are regenerated (the 0.4.0 release run did). 34, 34b and 35 were retaken for 0.7.0 (`e2e/gallery-070.spec.ts`, below): they had been made for 0.4.0, before the denser side view of 0.6.0 and the 3-D button under the chips.

| | | | |
|---|---|---|---|
| ![Placing the start of a line](docs/screenshots/33-air-slices-placing.png) | ![The side view on the 3-D atmosphere](docs/screenshots/34-air-slice-side-view.png) | ![The side view on the fast model](docs/screenshots/34b-air-slice-diagnosed.png) | ![The curtain and its colour chips](docs/screenshots/35-air-slice-curtain-chips.png) |
| The Air slices tool placing A: the cross over the map, "Place A here" and Cancel | The side view of a line along the wind on the 3-D atmosphere: six chips, the probe, the footer "3-D time-stepped air · model grid 133 m · air from ..." | The same on the fast model: Temp and Smoke are off, *Use the 3-D atmosphere* sits right under the chips (since 0.7.0; before, under the controls), the footer says "Diagnosed wind: terrain effects only" | The 3-D curtain in the scene, coloured by Up/down, with the Layers panel's chips to colour it |

The picture of 0.4.1 (the time-lapse recorder of an Air slice line) is made by one more test of the same spec, `gallery 0.4.1: the side view of
a recorded line ...` (36; run alone with `-g "gallery 0.4.1"`, which writes only that picture). A preset was kept with *Keep this line*, the run
played on until the recorder held 14 minutes of pictures, and the time was scrubbed back into them. *Keep this line* is on offer only for a live
preset and *Clear recording* only while something is recorded, so the two are never on screen together; this picture is the second state.

| | | | |
|---|---|---|---|
| ![The panel of a recorded line](docs/screenshots/36-air-slice-recorded.png) | | | |
| The panel of a recorded line, scrolled to its controls: *Clear recording*, the status line "Recorded from 12:23 to 12:37 (every picture kept).", and the footer "3-D time-stepped air · model grid 133 m · recorded air from 12:32" | | | |

The pictures of 0.5.0 (the wind arrows and flow lines, the Map view tab of Air slices, *Turn off the slice*) are made by two more tests of the same spec,
`gallery 0.5.0: the wind arrows and flow lines at three zooms ...` (37, 37b, 38 and 39) and `gallery 0.5.0: the Air slices tool, the Map view tab, and Turn off
the slice ...` (40 and 41); `-g "gallery 0.5.0"` runs them alone and writes only those pictures. They are Katoomba at 6 km on the fast model (so the wind is the
diagnosed wind), with the animated Wind streaks off and the 10 m chip; 40 and 41 were taken after *Keep this line* and a minute of recording at 120x. 37 and 37b are the 0.5.0 pictures; 38, 39, 40 and 41 were retaken for 0.7.0 (`e2e/gallery-070.spec.ts`, below) because the closest zoom has been the detailed streaks since 0.6.0 and the Wind height chips are seven, with *What the fire feels* first and chosen at the start.

| | | | |
|---|---|---|---|
| ![Straight arrows from far away](docs/screenshots/37b-wind-arrows-far.png) | ![Flow lines at a middle zoom](docs/screenshots/37-wind-flow-lines.png) | ![Long flow lines close in, through the trees](docs/screenshots/38-wind-flow-lines-trees.png) | ![The Layers row](docs/screenshots/39-layers-wind-arrows.png) |
| Level 1, straight arrows: the whole 6 km area across the screen, one model cell about 9 px, the 10 m chip; the card says "Wind near the ground" | Level 3, one model cell about 50 px, top view: flow lines with arrowheads (over this smooth part of the model's field they are nearly straight; the colour carries the speed) | Level 4 over the forest at a tilt of 55 degrees, with the trees and the aerial photo on (retaken for 0.7.0): since 0.6.0 the closest zoom draws the detailed streaks, comet-shaped and showing through the crowns, and the Wind detail chip shows four dots | Layers, Wind and air (retaken for 0.7.0): the *Arrows and flow lines* switch, the seven *Wind height* chips with *What the fire feels* first and chosen, the *Colour the map by speed* chip, and the caption (the fast model's diagnosed wind) |
| ![The Map view tab](docs/screenshots/40-air-slice-map-view.png) | ![Turn off the slice](docs/screenshots/41-air-slice-turn-off.png) | | |
| The Air slices tool's *Map view* tab (retaken for 0.7.0): the same switch, the seven chips and the caption as Layers; the zoom line and *Turn off the slice* with its hint "This also clears the recording." are further down the same tab | The *Side view* tab after *Keep this line* (retaken for 0.7.0), scrolled to *Clear recording* and *Turn off the slice* with the same hint | | |

The pictures of 0.7.0 are made by a spec of their own, `e2e/gallery-070.spec.ts` (six tests named `gallery 0.7.0: ...`; `-g "gallery 0.7.0"` runs them alone, and they write only the pictures below and the retaken ones above). They are Katoomba at 6 km on the fast model (the 3-D tier for the retaken 34 and 35), nothing from the network, a Pixel 7 profile at a device scale of 2, in software rendering; where a picture needs a fire, one is marked on the escarpment and the run is played to a quarter of an hour at 600x. Light, and dark where a caption says so. The picture of the streaks round the crowns (46) is a first one and will be retaken when the last change to how the lines bend round a crown has landed.

| | | | |
|---|---|---|---|
| ![What the fire feels](docs/screenshots/42-wind-felt-flow-lines.png) | ![Colour the map by speed](docs/screenshots/43-wind-colour-by-speed.png) | ![The Layers row with the map chip](docs/screenshots/44-layers-colour-by-speed.png) | ![The speed test](docs/screenshots/48-speed-test.png) |
| *What the fire feels* (the default Wind height), top view, one model cell about 50 px: arrows and flow lines from the wind the fire model uses, in cells of about 60 m; the card says *Wind the fire feels* | *Colour the map by speed* on at the same height: the Wind speed map under the arrows, with its legend card *Wind speed the fire feels* (0 to 60+ km/h); the arrows keep their own colours | Layers, Wind and air: the seven *Wind height* chips with *What the fire feels* chosen, the pressed *Colour the map by speed* chip and its caption (a dark picture is kept too) | The debug statistics after *Run the speed test*: the *Speed test* row holds both kernels and their ratio to the build machine; the figures (51.6 million cell updates a second, 5.27 GB a second) are those of the software-rendering machine that took the picture, so they say nothing about a phone (a dark picture is kept too) |
| ![The Wind detail sheet](docs/screenshots/45-wind-detail-sheet.png) | ![The sheet after the pause](docs/screenshots/47-wind-streaks-paused.png) | ![The streaks round the crowns](docs/screenshots/46-wind-streaks-round-crowns.png) | ![Wind direction after Apply](docs/screenshots/49-wind-direction-change.png) |
| The *Wind detail* sheet at level 4, the closest zoom: four dots, "Level 4 of 4: detailed streaks.", the wind the fire feels in cells about 60 m wide, and the sentence that says the bends and eddies are added for looks | The same sheet after a few seconds without a touch (the picture's limit is 3 seconds; the app's is a minute): the last line says "The streaks paused to save battery. Touch the screen to move them again." and the streaks stand still | The closest zoom over forest (150 m, a tilt of 55 degrees, the High picture quality, the trees and the aerial photo on): the detailed streaks ride the tree tops, and the lines part round the crowns and slide along their rims | *Wind direction* after *Apply* (a quarter turn from NW to NE from 12:53): the change in the list, *Back to the forecast* under it with its sentence, and *Turn wind to NE*; the timeline marks the change (a dark picture is kept too) |
| ![The card of your own wind change](docs/screenshots/50-wind-change-card.png) | ![The curtain on the fast model](docs/screenshots/35-air-slice-curtain-chips-fast.png) | | |
| The Insights list after the run played on past the start of the turn: the card *Your wind change: this flank becomes the head* and the *Dead man zone* card of the same change, both *Watch out* and never Danger, so neither pauses the run | The 3-D curtain on the fast model, seen from the side with its arrows, and the Layers panel's chips (Temp and Smoke are off on this model) | | |

## Features

- **Where**: GPS, a pasted **Google Maps link** (or typed coordinates), or nine bundled **demo sites** (Katoomba, Blackheath, Mount Tomah, Kanangra, Thredbo, Gospers, Pigeon House, Barrington, Warrumbungles) with the NSW 5 m elevation model (bundled at 10 m),
  canopy height (from Meta's 1 m map), aerial imagery, vegetation and fire history — they work fully offline. 3–12 km square, 20 or 30 m fire grid.
- **Weather**: live (Open-Meteo's automatic 'best match' forecast for the location, ECMWF IFS as the fallback, upper-air levels from ECMWF IFS 0.25° or GFS; BOM ACCESS-G is not requested: Open-Meteo reports its open data as suspended), a past date (historical forecasts / ERA5), the forecast
  (up to 16 days), four designed **presets** (hot NW wind ahead of a SW change; calm night with katabatic drainage;
  mild spring hazard-reduction day; catastrophic Black-Summer-like day), seven **historic fire days** bundled offline
  (Blue Mountains Oct 2013, Grose / Gospers Mountain / Kanangra Dec 2019, Currowan 30 Dec 2019, Snowy Jan 2020,
  Wambelong Jan 2013), **belt weather kit** readings (psychrometer at station pressure, 2 m → 10 m wind), or manual
  entry with an optional wind change. Drought (KBDI, Drought Factor) from a year of daily rain.
- **Fuel**: NSW vegetation (SVTM) → fuel types, NPWS fire history → fuel accumulation, canopy height, with a
  plain-language **fuel brush** ("more leaf litter", "denser understorey", "stringybark", "less fuel (burnt / HR)",
  "road / track / rock", "wetter (gully / seepage)").
- **Fire**: mark the fire now (point or finger-drawn line), a spot fire ahead, or a back burn — also in the past,
  which re-runs the simulation from then. Wrong mark? Remove it and the run is repeated without it.
- **Simulation** (Web Worker, deterministic): dead fine fuel moisture per cell (aspect, shade, canopy, cold pools,
  dew, rain), Vesta Mk2 / CSIRO grassland / heath / pine models, a level-set front with directional slope, mountain
  phenomena (eruptive slopes and chimneys, vorticity-driven lateral spread, junction zones, rolling debris), a 3-D
  terrain-following atmosphere (slope winds, cold-air drainage, thermal belts, the fire's own indraft and plume) or a
  fast tier that fits the forecast wind to the terrain instead of stepping air through time (the Saver profile, or when Auto finds that the 3-D air would take far too long on the phone; its wind is published as the *diagnosed wind*, see *Air slices and the air picture*), and Lagrangian embers with
  spot-fire ignition. The app says when the simulation cannot keep up with the speed you chose (see *Speed and the
  timeline signal*); the result never depends on speed.
- **Explanations**: insight cards as the fire does something worth learning (upslope run, ridge-crest slowdown,
  gully chimney, lee-slope eddy / VLS, spotting, crown fire, wind change: "the flank becomes the head", dead man zone,
  pyroconvection…), repeats grouped per phenomenon, "Show me" switches on the layer that makes it visible.
  **Why here?** — tap anywhere for the factor breakdown (wind, slope, moisture, fuel, terrain, position on the fire)
  and a narrative. Tap an **icon** (the fire you marked, a spot fire, an insight marker, your own position, a home) and the
  panel opens with that icon as the map draws it and its name in a word or two (for example "Spot fire" or "Danger: Uphill
  run"), and the question is about the icon's own spot; tap the ground and there is no icon row.
- **Air slices** (Tools, 0.4.0): a side view of the air along a line you place anywhere on the map, on every run. Place the start (A) and
  the end (B) with the cross, or tap a preset (**Along the wind**, **Across the wind**, **Up the slope**, **Me to fire**). A flat panel draws
  the air in the plane of the line, with the ground, height and distance axes, flow streaks, colour chips (Speed, Along, Up/down, Across,
  Temp, Smoke), and a **probe**: tap or drag to read the wind, the up or down air, the height above the ground and, on the 3-D atmosphere,
  how much warmer or cooler it is, in one plain sentence, with a pin on the map. A footer always says what kind of air it is, how fine the
  model grid is and when the air is from. The same slice stands in the 3-D view as a curtain. On the fast model it shows the **diagnosed
  wind** (the forecast wind fitted to the terrain, terrain effects only) and says so; Temp and Smoke need the 3-D atmosphere. A line you
  place with A and B is also **recorded** while the run plays (0.4.1; a preset is recorded once you press **Keep this line**), so scrubbing
  back shows the air recorded at that time ("recorded air from 11:25") instead of the older saved air, and **Clear recording** empties it.
  Since 0.5.0 the tool has two tabs, **Side view** and **Map view** (the wind arrows and flow lines), and a **Turn off the slice** button that
  takes the line, the curtain and the recording away in one press and leaves the tool open. It only reads the air and never changes the fire.
  See *Air slices and the air picture*.
- **Wind arrows and flow lines** (Layers, Wind and air, 0.5.0): the wind drawn on the map at a height you choose (What the fire feels, 10 m, 50 m, 100 m, 300 m, 1 km or
  2 km), with marks that get more detailed as you zoom: straight arrows from far away, closer-set arrows, curved flow lines with arrowheads and,
  close in, the detailed streaks of 0.6.0 (below). They keep their size on the screen, wear the colours of the wind streaks (pale for a light wind, violet for a strong
  one, with a km/h legend card), show through the trees, never run down a cliff face and stop at the edge of the model. A caption says which wind
  it is, how fine the model grid is and when the air is from, and says plainly that the curves are a smooth fit through the model once one cell is
  wider than about 60 px. Off until you switch it on (the animated wind streaks are a separate control), on both tiers, also in the Air slices tool's
  Map view, where it is the same setting. It only reads the air. See *Wind arrows and flow lines*.
- **Wind detail** (0.6.0): while the Wind streaks or the arrows and flow lines are on, a 44 px chip, "Wind detail", with four pips (a filled circle for each step
  reached), stands at the bottom left of the map above the legend card and says how detailed the wind on the map is at this zoom. A tap opens a short sheet: which of
  levels 0 to 4 is drawn, what the picture is, which wind it shows, and what holds it back (the zoom, the model's cell size, a full drawing budget, the fast model's
  estimated wind, reduced motion). It is not shown for the Wind speed map. See *Wind detail and the detailed streaks*.
- **Detailed streaks** (0.6.0): at the closest zoom (level 4, a model cell wider than about 90 px) the Wind streaks and the arrows and flow lines draw one
  picture, comet-shaped streaks with a bright head and a fading tail that move along the wind, coloured by the model's speed, with small eddies in the lee of ridges and trees.
  The eddies are added for looks, from the shape of the ground; the model does not calculate them, and the sheet says so. Display only. Since 0.7.0 the streaks also ride on the tree tops
  where trees are drawn, part round tree crowns and slide along a rising slope, and curl into pairs of eddies behind the tallest trees, in the lee of a ridge and downwind of the fire's plume. See *Wind detail and the detailed streaks*.
- **What the fire feels** (0.7.0): the first Wind height chip, and the one the app starts with: the wind the fire model is given in each cell (slope flow, lee eddies and the fire's own
  effect on the wind included), averaged to cells of about 60 m, published in every snapshot (a 10 to 160 kB picture) and kept by the history with its keyframes. The caption says what it is
  and that it is not a measurement. See *The wind the fire feels and Colour the map by speed*.
- **Colour the map by speed** (0.7.0): a chip under the Wind height chips that paints the Wind speed map at the height you chose for the arrows (0 to 60 km/h from What the fire feels to
  100 m, 0 to 90 km/h from 300 m), with a legend that names the wind. No new heat map: it is the Wind speed row, so one heat map shows at a time. It needs a fire marked, like the row. See
  *The wind the fire feels and Colour the map by speed*.
- **Idle stop and reduced motion** (0.7.0): after a minute without a touch the whole view holds still and stops drawing, to save battery, and any touch wakes it; a running simulation never
  lets it hold still. When the phone is set to reduce motion, the older Wind streaks and the swaying of the trees stand still too. See *Wind detail and the detailed streaks*.
- **Wind direction** (Tools, 0.6.0; it replaces the old per-place Local wind tool): pick where the wind should come from on a dial and when (Now, In 10 min, In 30 min,
  In 1 h or At a time), and the wind of the whole map starts to turn then, takes 15 minutes to reach that direction the short way round, and holds it until your next
  change; the forecast's later direction changes no longer apply, the wind speed stays as forecast, and the whole column of air turns. Every change is listed with a
  Remove button that takes it away as if it had never been made, and **Back to the forecast** takes away every change you made in one press (0.7.0). A change of yours has its own wind change card
  and, while it is ahead, its own Dead man zone (0.7.0: Watch out, never Danger). It changes the simulation, deterministically. See *Wind direction*.
- **Views**: 3-D orbit, top view, eye level ("what you would see from here"), wind particles (surface or through the plume), wind arrows and flow lines,
  the air slice's curtain, vertical exaggeration, compass and zoom buttons for gloved hands. One finger slides the map and the spot it touched stays under it, two fingers
  turn, tilt and zoom it, all at once (see *Controls*).
- **Cliffs**: in the 3-D view, cliff faces are drawn as near-vertical rock walls, lit from the sharpened ground, with ledges that catch
  the light, vertical joints, dark bands under overhangs, water stains, scree below a face and bare pavement along the top, and no
  trees on bare faces. It is always on and trimmed by Picture quality. It is a drawing only: the simulation, the slope overlay and
  every number use the terrain as received, and the fire model's own rule for very steep ground is the one it had before (see
  *Cliffs: what is drawn and what is simulated*).
- **Layers**: one panel built from a catalogue of layers (`src/render/layerCatalog.ts`), each with a plain "what it shows, why it
  matters, where the data come from, how fine it is". *Map type* (aerial photo, terrain colours, plain), with **Night lighting**
  (Realistic, Brighter, Daylight: see *Night lighting* below); *Map details*, a switch for
  each: 3-D canopy, shrubs, **roads and tracks**, **fire trails**, **homes**, **residential and built-up areas**, **place names**,
  flames, smoke, embers, wind streaks, **wind arrows and flow lines**, insight markers; and *Heat maps*, every data layer as a colour map of the ground (cool = little,
  warm = much), one at a time, optionally **on its own** (the photo and the trees step aside): ground height, landform, slope, aspect,
  sunlight, tree height and cover, shrub height, the four fuel hazards (leaf litter, grass and low shrubs, shrubs, bark), grass curing,
  fuel type and load, years since fire, wildfire or prescribed burn, homes per hectare, distance to a road, wind speed (on both tiers: the fast model shows its diagnosed 10 m wind; on a calm night it is not the wind the fire feels, see *Limits* under *Air slices and the air picture*), litter moisture
  and the fire results (arrival time with isochrones, spread rate, intensity, spread driver, flame attachment, VLS, dead man zone, ember
  landings). A layer that cannot be shown says why ("Needs a fire: mark one first"). Your choices are remembered for the next run.
- **Places**: roads, RFS fire trails, homes, residential zones and place names are official NSW open data, bundled for the demo
  sites (so they work offline) and queried live elsewhere (see *Roads, homes and place names* below). "Why here?" says where you are:
  the nearest road and fire trail, the zone, homes within 500 m and 1 km, and the ground.
- **Data sets screen**: the size, origin, age, licence and resolution of every data set a scenario used (terrain, aerial photo,
  vegetation, canopy, fire history, weather, upper air, rainfall, roads, trails, homes, zones, names, the derived fuel map and your
  edits), how much came from where, what was a substitute and why, the model's grid, the memory a run holds, and what the phone stores
  (with Delete and Clear, always after asking). Before a run, Setup shows the same list as a plan with estimated sizes (*Data for this
  run*). Details below (*Data sets and provenance*).
- **How this simulation works**: what is 2-D and what is 3-D in the run you are looking at, the grids and steps, what the model can and
  cannot resolve and how sure it is, from the engine's own report (see *Transparency* below).
- **Simulation debug statistics**: one screen with the numbers behind the run, measured on this phone: the tier in use and why, the
  computing speed (last 10 s and 60 s, the run's mean, the best and worst 10 s, a history), where the time goes (air, fire,
  embers and the rest), memory, the frame rate, what the phone is (model, Android, WebView, cores, memory class, GPU and graphics
  features) and the recent events, and, since 0.7.0, a **Speed test** button (about 2 seconds, compared with the build machine). A Copy button puts the whole page on the clipboard as plain text, so a phone's readout can be
  pasted into a message. It sits directly under Settings in the main menu (and in Settings, Setup and the model card). Details
  below (*Simulation debug statistics*).
- **Picture quality** (Settings → Simulation): Auto, Low, Medium or High for the 3-D picture. Auto picks from the phone's cores
  and memory (the Detail performance profile asks for High); it applies to the next model you build. See *Picture quality* below.
- **The trees** (Layers → Trees): the 3-D canopy is drawn from the data, at the real canopy height: stringybark has a thick dark fibrous
  trunk, ribbon bark a pale trunk with hanging streamers, smooth gums a pale smooth trunk (the ember-source hazard you can
  see); tall wet forest, rainforest, snow gum, pine rows, heath, understorey shrubs at their real height (the ladder fuel)
  and grass that turns straw with curing. Trees scorch, torch and burn out with the fire, old burns show epicormic shoots,
  and they lean in the wind. Three styles: natural, simple (clean shapes) or colour-coded by height, cover, bark or
  understorey hazard. Trees fade out in the top view and around the flames, so nothing hides the fire.
- **Time**: play at 0.25×–3600× (presets, a slider, or your own number), or as fast as the phone can; tap or drag the
  timeline, or type a time, to jump to ANY moment of the scenario: back is instant, and a time not yet computed becomes a
  fast-forward with its progress on the track (Cancel stops it, the view lands exactly on the time). There is no "Live" button: Play
  carries on from wherever you are, and backgrounding the app pauses a run or a fast-forward. Pictures are 60 s
  apart by default and can be 10 s to 10 min (Settings or the clock menu), with the solver step configurable too.
  If the phone cannot compute as fast as the speed you chose, a small gauge button appears at the end of the timeline (and
  only then): tap it for what is happening, that it never changes the result, and what to do. Nothing pops up by itself.
  **What if** (fire–atmosphere feedback, embers, mountain phenomena on/off → re-run from now and compare).
- **Field UX**: the map is the star, in a flat Google-Maps-for-Android look with a little less white space than stock: a floating
  top pill (menu, clock, Play, speed) with read-out chips for the weather and the fire-danger rating, a column of round map buttons
  (Layers, View, Compass), a Tools button with a speed dial, and bottom navigation (Insights, Weather, Stats, Help) over the timeline;
  everything is collapsed until asked for, nothing ever pops up over the simulation (new insight cards raise a badge on the Insights
  tab) and nothing pauses it (pause on Danger and vibration are opt-in). Big targets (44 px at least), crosshair placement for gloves
  and wet screens, light, night and **high-contrast** ("bright sun", Settings) looks, left/right-handed layout, Android's Back button
  closes the top-most menu, panel or screen first, screen-reader labels, text up to Android's 200 % font scale without clipping.

## Versions

| Version | What it is | State |
|---|---|---|
| 0.3.0 (versionCode 6) | night lighting, picture quality, the debug statistics, the honest speed signal, the cliff drawing, tap on an icon | built and checked on the real app in software rendering; not seen on a phone |
| **0.4.0** (versionCode 7) | the **air data foundation** (every tier publishes a 3-D wind that can be sliced, exact near-ground sampling, capability flags) and **Air slices**, the side view | built and checked the same way; not seen on a phone. Built as versionCode 7. What was built and what the checks found: `docs/plans/air-slice-wind-detail-honest-speed.md`, section 18 |
| 0.3.1 (optional) | rock in the fire model (a wall that means bare rock, part-rock cells) and a speed test button | the **speed test button was built in 0.7.0**; the rock part (H-sim) is **not built**: it waits for someone who knows the escarpments to re-label the 80 aerial tiles of spike S6 (decision D17) |
| **0.4.1** (versionCode 8) | a **time-lapse recorder** for a pinned Air slice line: the side view reads the air recorded at the time shown instead of the older saved air, with *Keep this line* and *Clear recording* | built and checked the same way (an independent check on the real app of the recorder and of the tool, the words and the statistics); not seen on a phone. Built as versionCode 8. What was built, the corrections to the plan and the limits: `docs/plans/air-slice-wind-detail-honest-speed.md`, section 19 |
| **0.5.0** (versionCode 9) | the **wind arrows and flow lines** (zoom-adaptive, at a height you choose), the Air slices tool's **Map view** tab and a **Turn off the slice** button: stage E1 of workstream E only | built and checked the same way (three independent checks on the real app, two fix rounds); not seen on a phone. `package.json` and `android/app/build.gradle` say 0.5.0 (versionCode 9). What was built, the corrections to the plan and the limits: `docs/plans/air-slice-wind-detail-honest-speed.md`, section 20 |
| **0.6.0** (versionCode 10) | five requests of the owner: a **Wind detail** chip that says how detailed the wind on the map is at this zoom; **detailed streaks** at the closest zoom (level 4); the two-finger turn **inverted** (touch only); **Wind direction**, a tool that turns the wind of the whole map from a time you choose, in place of the old per-place Local wind tool; and **twice as many streaks and arrows** in the Air slice's side view | built and merged; independent verifiers check it on the real app and engine in software rendering and in node (their record is plan section 21, 21.x); not seen on a phone. Built as versionCode 10. What was built, the decisions taken for the owner, the corrections to the plan and the limits: `docs/plans/air-slice-wind-detail-honest-speed.md`, section 21 |
| 0.5.1 (optional, not scheduled) | colouring the map by wind speed (E1b) and a 60 m "wind the fire feels" raster (E2) | **built in 0.7.0** (the next row): 0.5.0 and 0.6.0 did not build them |
| **0.7.0** (versionCode 11) | everything the owner asked to have followed up after 0.6.0, in one release: **Colour the map by speed** and the 60 m **What the fire feels** wind (E1b and E2); the **speed test** button; the **Wind direction** follow-ups (cards and a Dead man zone for a change of your own, **Back to the forecast**, the Danger-gate gap closed); detailed streaks that **ride the canopy, part round tree crowns and ridges and curl into eddies**; an **idle stop** after a minute without a touch; the older Wind streaks and the trees obeying **reduced motion**; and eight smaller fixes (the side view's arrow floor, the curtain's arrows where seen edge on, a tap miss at 844 x 390, the debug row, the two-finger turn without private members of three, the glyph hash note, the Air slices tool's 3-D button under the chips). Asked for during the release: a **one-finger pan that holds the touched ground** and **15 % faster turning**, and a build that is **25.9 kB gzip smaller** | built and merged; independent verifiers check it on the real app and engine in software rendering and in node (their record is plan section 22, 22.x); not seen on a phone. **Not built: H-sim** (rock in the fire model; blocked on the S6 re-label). `package.json` and `android/app/build.gradle` say 0.7.0 (versionCode 11). What was built, the decisions taken for the owner, the corrections to the plan and the limits: `docs/plans/air-slice-wind-detail-honest-speed.md`, section 22 |

## Choosing a place from a Google Maps link

Setup → **Where** takes a place three ways: *Use my location* (GPS), one of the bundled demo sites, or the box **"Or paste a Google
Maps link or coordinates"**. In Google Maps touch and hold the spot (or open the place), tap **Share** and paste what it gives you
(or tap the link button beside the box to paste from the clipboard). The app reads the position out of the text and shows it as a
result row like the GPS fix: the latitude and longitude, the place name when there is one, whether it is **In NSW**, whether
the app has **bundled data** for it (a demo site covers it, so it works offline), and **Clear**. The data plan below it follows the place.

What it understands (`src/ui/mapsLink.ts`, table-driven tests in `src/ui/mapsLink.test.ts`, about 190 cases):

- **Google Maps addresses**: `/maps/place/<name>/@lat,lon,17z/data=…!3d<lat>!4d<lon>` (the pin wins over the `@` map view, which can
  be kilometres away), `/maps/@lat,lon,zoom`, `?q=lat,lon`, `q=loc:…`, `q=Name@lat,lon`, `?ll=`, `?center=`,
  `/maps/search/lat,+lon`, `/maps/search/?api=1&query=`, embed addresses, a route that has one clear point (a route between two places
  is refused: "Open the place and share that"), on `google.com`, `maps.google.com` and every country domain (`google.com.au`, `google.co.uk` …),
  with encoded commas, plus signs, percent-encoded names, trailing punctuation and upper-case hosts.
- **The text Google's Share makes** (a place name, maybe an address, then the link): the first Maps link in the text is used, and the
  name is the first line (it becomes the scenario name; otherwise "Your location").
- **Plain coordinates** as before and more: `-33.5447, 150.4097`, `33.5447° S 150.4097° E`, `S 33.5447 E 150.4097`,
  `33°32'44.2"S 150°24'35.1"E` (with ′ ″ ’ ” marks), degrees and decimal minutes, `lat … lon …`; a longitude-first pair is swapped and says so. A comma as the
  decimal point is not supported (the message says to use a dot).
- `geo:` links, OpenStreetMap links, and Google's wrapper links (`consent.google.com/…?continue=`, `google.com/url?q=`).
- A **short link** (`maps.app.goo.gl/…`, `goo.gl/maps/…`) holds no coordinates. See below.

**What leaves the phone.** Nothing for a long link, coordinates, a geo: or OpenStreetMap link: they are read on the phone. For a Google
short link the Android app makes **one request to Google's own short-link address** (`src/ui/mapsShortLink.ts`, through the native
HTTP stack, so CORS does not matter): it asks for the redirect only (`disableRedirects`), reads the `Location` header, and takes the
position from the address Google redirects to. No account and no custom header is sent (the phone's HTTP stack adds only its usual
User-Agent; the app itself keeps no Google cookies), it times out after 15 s, retries once, and
follows Google's own addresses only, by hand (one request per redirect, always over https, never to another host or port): a short link that leads
anywhere else is refused and never opened or read. Only a Google short link is ever requested; no other pasted address is fetched. (If the address
Google hands over has no position in it, its page is read as a last resort, at most 512 kB of it, and that page is Google's too.) (A real `maps.app.goo.gl` link on 2026-10-07 answered with one 302 straight to the
`/maps/place/…` address, 100 to 900 ms. A link to a place that has only a place id and no position, which does exist, comes back as "This
link names a place but does not say where it is".) In the plain web build the browser hides the redirect, so the app says "Short links only
work inside the Android app. Open the link in a browser and paste the long address, or paste the coordinates." and asks nothing.
**What is remembered**: only the coordinates (`-33.54470, 150.40970`). The pasted link, which carries a place id, and the share text are
never stored, in the remembered last setup or anywhere else; the place name lasts only until the app is closed.

## Controls

The map is moved with the fingers, the same in the 3-D view and the top (plan) view:

| Gesture | What it does |
|---|---|
| **One finger drag** | slides the map like grabbing it: the ground under the finger stays under it, at any tilt, down to 5 degrees below the horizon (0.7.0: the speed of the view is the touched ground's own, not the orbit target's; a light glide carries on when you flick and let go; touching the map stops it) |
| **Two fingers moving together** | turns the view (sideways drag) and tilts it (up or down); the top view can only turn. Since 0.6.0 a drag to the right turns the camera anticlockwise seen from above, so the map seems to turn clockwise under the fingers (touch only: the mouse and eye level are unchanged). Since 0.7.0 turning and tilting are 15 % faster: 276 degrees per screen height of drag (240 before), 34.5 degrees per 100 px on an 800 px canvas |
| **Pinch** | zooms towards the point between the fingers |
| Pinch **and** drag in one movement | zooms and turns / tilts at the same time (no mode to pick) |
| Lift one finger of two | carries on as a one-finger slide from where the other finger is; a second finger put down during a slide switches to turn / zoom, without a jump; a third finger is ignored |
| **Tap** | "Why here?" (or places the fire / fuel brush when that tool is open); a slide is never a tap |
| **Air slices, placing a line** | with "Set start (A)" or "Set end (B)" chosen, the cross is shown and one finger still slides the map under it; "Place A here" keeps the point under the cross. A tap on the map sets a dashed mark instead, and "Place A here" then keeps that point (the two-step confirm for gloves and wet screens). Back or Escape drops the placement first and closes the tool next |
| **Tap an icon** (with the Why here? tool) | opens the panel with that icon and its name at the top, and asks about the icon's own spot: the ring jumps onto it. A tap within about 22 px of an icon's centre counts (a home: 14 px); the nearest icon wins, and a stack says "+2 more icons here, zoom in to tell them apart". Tap the ground beside it and there is no icon row. The other tools that place something (fire and fuel) still use the ground under the finger; Wind direction places nothing, it turns the wind of the whole map |
| **Eye level** ("what you would see from here") | a first-person look-around: one finger turns the view (a second finger pauses it); you cannot slide your position, there is no zoom |
| Drawing a fire line or painting fuel (**Draw a line** in Fire, **Paint** in Fuel) | one finger draws and the map is locked; switch back to tapping to move the map again |
| Mouse (desktop development) | left button slides, right button turns and tilts (a drag to the right turns the camera clockwise seen from above, as OrbitControls does: only the two-finger touch turn was inverted; 15 % faster since 0.7.0, like the touch turn), middle button or wheel zooms |
| Round buttons (View menu) | zoom in / out, the 3-D, top and eye-level views, fly to the fire or to you, turn the map north up. Turning and tilting by hand have no button (two fingers; right mouse button), nor has sliding (one finger; left mouse button) |

Sensitivity: a pinch is 1 : 1 (fingers twice as far apart = half the distance) and two fingers dragged 1.3 screen heights
turn the view a full circle (`GESTURE.rotateSpeed` is 2/3 x 1.15 since 0.7.0: OrbitControls turns 2 pi x that per screen height of
drag, 276 degrees against 240 in 0.6.0; the eye-level look-around has its own speed and did not change). One finger **holds the ground it touched**
under it, so the speed of the view is that ground's own (the orbit target and its distance set nothing): ground near the camera, at the bottom of the screen,
moves the view slowly, ground far away fast, as it does on a real map (0.7.0; in 0.6.0 a finger on far ground moved the view at most five times as fast as
ground at the target, which made 9 to 46 % of the fingers of a zoomed-in oblique view lose the ground by up to tens of pixels on Katoomba's relief). At a flat viewing angle the ground near the
horizon covers kilometres per pixel, so terrain under the finger is held exactly only down to **5 degrees below the horizon** (`PAN.HORIZON_MARGIN_DEG`); a finger nearer the horizon holds that line,
so a few pixels of drag cannot throw the camera across the model, and a finger with no terrain under it (sky, beyond the model) holds what its ray meets first at the line where the plane through the target would move the view five times as fast as ground at the target (`PAN.SKY_SPEEDUP`).
The independent check measured 25 m of ground a pixel at 5 degrees below the horizon against 1.4 m in the middle of the screen, for a camera 600 m out at a tilt of 65 degrees, and about 90 m a pixel at 3 degrees,
the margin first built, which is why it is 5 now: far ground near the horizon is the one place where the map moves fast, by design. A flick glides in the finger's own speed over the ground it touched, so a flick on far ground
carries the view much farther than in 0.6.0: the camera verifier's harness (a flat 9 km model, 412 x 915, tilt 65 degrees, 600 m out, a flick of 3,000 px/s starting 25 degrees below the horizon, at the 3 degree margin) gave 3,527 m against 457 m (not re-measured at 5 degrees). Lifting the finger never moves the picture: the camera does not climb or sink with the terrain, the view's pivot (the
ground under the middle of the screen) just slides along the line of sight, so over a ridge or into a valley the scale changes a
little (−10 % to +20 % over a 100–400 px slide at the default tilt, 10th to 90th percentile on Katoomba's cliffs) as it would for
a camera flying at a steady height; in near-plan views (tilt under about 22°) and in the top view, which keep their scale, the
camera follows the terrain instead. The Help sheet in the app has the short version (Moving around the map).

## The science

The model specification is [`docs/research/00-synthesis.md`](docs/research/00-synthesis.md) (normative; every
coefficient cites its evidence). It synthesises ten research reviews:

| | |
|---|---|
| [01 Terrain and fire behaviour](docs/research/01-terrain-fire-behaviour.md) | slope factor, eruptive fire, chimneys, ridges, junctions |
| [02 Mountain meteorology](docs/research/02-mountain-meteorology.md) | slope and valley winds, cold pools, thermal belts, lee eddies, wind changes |
| [03 Australian fire models](docs/research/03-australian-fire-models.md) | Vesta Mk2 / 2012, CSIRO grassland, heath, McArthur, AFDRS FBI |
| [04 Fuel moisture](docs/research/04-fuel-moisture.md) | dead fine fuel moisture, aspect and shade, KBDI and Drought Factor |
| [05 Fuel accumulation and fire history](docs/research/05-fuel-accumulation-history.md) | Olson curves, time since fire, SVTM → fuel |
| [06 Embers and spotting](docs/research/06-embers-spotting.md) | firebrand generation, lofting, transport, burnout, ignition probability |
| [07 Fire–atmosphere coupling](docs/research/07-fire-atmosphere-coupling.md) | the 3-D solver, fire heat release, convective number, plumes |
| [08 Data sources and APIs](docs/research/08-data-sources-apis.md), [08b live checks](docs/research/08b-live-endpoint-verification.md) | every endpoint the app uses |
| [09 Mobile tech stack](docs/research/09-mobile-tech-stack.md) | Capacitor, WebGL, workers, field UX |
| [10 Firefighter education](docs/research/10-firefighter-education.md) | LACES, Watch Outs, card wording, safety content |

Validation against the spec's scenarios (§15, V1–V22: slope ratios, wind–slope interaction, ridge crests, night
slowdown, katabatic and anabatic flows, spotting distances, VLS, gullies, wind changes, recent burns, junctions,
plume regimes, determinism and rewind) runs headless in `src/sim/validation/`.

Exploratory studies that are **not part of the app** live in [`studies/`](studies/), one folder per ongoing topic
(first topic: [cliff from photo](studies/cliff-from-photo/), whether photographs can improve how cliffs are drawn and described).

## Transparency: what is simulated

*Is it 2-D or 3-D?* Both, by component, and the app says so for the run you are looking at: **How this simulation works**
(Stats tab → *How the model runs*, Settings, and Setup → *Area and detail*, where it previews the plan of your form before
anything is built). It opens full screen on top of the running simulation, never pauses it, and answers from the engine's own
report, not from text:

| Component | Dimensions | Resolution (a 6 km Katoomba run, as an example) | Time step |
|---|---|---|---|
| Terrain | 2.5-D: one height per point | 30 m fire cells (200 × 200); a 10 m grid for the view and the air (the demo sites' 5 m model resampled; away from them it is interpolated from the 30 m SRTM heights, so smoother but not finer). The 3-D view draws cliff faces steeper than this grid; the simulation and every number use it as received | fixed |
| Fuel | a vertical **column of layers per cell** (litter, near-surface, shrubs, bark, canopy), not 3-D blocks | the fire cells | fixed, except fuel edits and burning |
| Weather forcing | one time series at one point plus an upper-air profile, applied to the whole area | records about every hour, linear in between | - |
| Litter moisture | 2-D, one value per cell | the fire cells | every 10 min of fire time |
| **Fire spread** | **2-D level-set front** on the terrain surface (empirical rates: Vesta Mk2, CSIRO grassland, AFDRS heath, pine), not resolved combustion | 30 m (20 m for areas up to 6 km on *Detailed*) | sub-steps from the CFL limit inside the outer step |
| **Atmosphere** | standard / high tiers: **3-D** Boussinesq flow on a terrain-following grid; **fast tier: no time-stepped air**, the forecast wind fitted to the terrain by a mass-consistent solve (one per weather record, blended in time); the fire feels a 2-D surface wind built from it, and the fitted 3-D wind itself is published as the *diagnosed wind* (terrain effects only: no temperature, no smoke) | 45 × 45 × 20 columns about 133 m apart (standard, 6 km), 60 × 60 × 24 (high); the fast tier fits the wind on the standard grid | 3 s to 12 s (shorter in strong wind); fast tier 10 s |
| Fire and air feedback | two-way in 3-D; a 2-D indraft estimate in the fast tier | the air grid / the fire grid coarsened ×2 | every step |
| Embers | **3-D** Lagrangian particles (up to the performance profile's maximum) | individual tracked particles in 5 bark and fuel classes | every outer step |
| Smoke | 3-D tracer in the 3-D tiers; only a drawn column in the fast tier (the Smoke chip of an air slice is off there) | the air grid | every air step |
| Display | 3-D rendering; **trees are decorative** (placed from canopy cover and height), **cliff faces are a drawing** (steeper than the data, with rock detail), roads, trails, homes and names are map data | - | a picture every display step |

The page has seven groups (the first open, the rest collapsed): *At a glance* (one card per component with dimensions, resolution,
time step, method in plain words, an evidence badge and the spec section), *What it can and cannot resolve* (derived from the
real grid sizes: the smallest ridge or gully the air grid can show is about twice its spacing; what is parameterised instead
of resolved; what is not represented at all), *How sure are we?* (evidence tags of the specification, the open issues of its
§16 that change numbers on screen, the validation summary), *Data in this run* (a short summary; the Data sets screen has the
detail), *Layers and what they show* (the layer catalogue with each layer's dimensionality and resolution), *Speed and memory
right now* (four live numbers: the tier in use and why, the computing speed, the engine's memory and this phone, with a row that
opens *Simulation debug statistics*, where the long list that used to be here now lives) and *Words used*. *Copy as text* exports
all of it. The page is loaded the first time it is opened.

**How the numbers are kept honest.** `Simulation.makeSnapshot` attaches `SimSnapshot.engine` (`EngineInfo`,
`src/core/simTypes.ts`), read from the modules themselves (the atmosphere's own grid, the fire grid, the level set's last CFL
bound, the ember model, the cadences of `SIM_PARAMS`, the tier in force and why: requested, auto-tune with its measurement, or
changed during the run), with the engine's memory measured by `memoryReport()` at most every 30 s and its timing statistics
(`EngineInfo.perf`, from `src/sim/perfStats.ts`: speeds, step times, where the time goes, re-runs, events). `describeModel()`
(`src/ui/modelInfo.ts`, pure) turns that, the scenario and the settings into the card; before the engine reports (or from
Setup) the numbers are *planned* with the same rules the builder and the engine use, and the card says so. A tier switch
mid-run changes the wording from the checkpoint on. The demo engine (`?mock=1`, or when the worker cannot load) says that it
is a stand-in. Static statements were checked against the code and the specification; the counts quoted from the
specification and the README are re-checked by `src/ui/modelInfo.test.ts`.

## Speed: what the app measures and what it says

Detailed mode is allowed to be slower than playback. The app measures that, says so where you are looking, and explains it on
tap. None of it changes a result: the engine's own timings are read, never fed back, and the snapshot hash skips them
(`src/sim/simulation.test.ts` runs the same scenario on both kinds of tier with the statistics off, on, and on with a wildly
perturbed clock, in chunks of several sizes and across a rewind, and compares every snapshot hash).

**Auto, decided once.** *Settings, Performance, Balanced* (the default) times 30 steps of the 3-D air's spin-up when a run starts,
leaves out the first 10 (the JIT warm-up, which inflates the first readings) and takes the **median** of the other 20
(`autoTuneDecision`, `src/sim/engineInfo.ts`; constants in `SIM_PARAMS`, `src/sim/params.ts`). It predicts the whole run as
1.4 x that step x the number of 10 s steps and keeps the **detailed 3-D air** unless the prediction is over a limit: 10 minutes of
computing for 6 hours of fire, scaled by the run length, never under a minute. For every run of 36 minutes or longer (Setup offers
1 to 12 hours) the limit is a step of 198.4 ms; only a shorter run, which Setup does not offer, is held up by the one-minute floor
(`428571 / duration in s` ms, so 238 ms at 30 minutes). Over it, Auto picks the fast surface-wind model and says why with the numbers. This is the only place
the wall clock reaches the engine: the tier never changes by itself afterwards (a test pins it, with a clock that turns very slow
mid-run), only you change it (Settings, or Layers, *Use the 3-D atmosphere*). Saver always runs the fast model; Detail runs the
high 3-D tier. The report keeps both the warm-up mean and the steady median (`EngineInfo.autoTune`).

**What has been measured.** Only one phone so far: on it the 3-D step took 41 ms. That was the mean of the first 20 steps, warm-up
included, which is what Auto read before 0.3.0; it predicted 124 s for a 6-hour run against a 120 s limit and chose the fast
model. The new rule would have kept the detailed air at that reading, and the limit of about 198 ms is 4.8 times that. The app
does not claim what most phones do: it reports what this phone does (*Simulation debug statistics*).

**The signal on the timeline.** If the speed you chose is higher than the phone can compute, the clock reaches the newest result and
waits. `src/ui/paceModel.ts` (pure) watches that and, only while it is true, a 44 x 44 px gauge button appears at the end of the
timeline (the track gets 44 px shorter). *Behind* (early warning: the worker computes under 90 % of the asked speed while busy at
least 90 % of the time, for 10 s) is a faint outline. *Waiting* (the clock held at the newest result for 15 % or more of the last
10 s, for 6 s in a row) is a 3 px ring and a 44 px run under the rail that ends at the thumb, drawn in the `--watch-ink` colour. It is
never colour alone: the glyph, the ring's thickness and the button's name carry the meaning. Nothing pops up and nothing vibrates; a
screen reader hears one polite line when playback starts to wait (at most every 2 minutes). The button is left out while a jump
computes, after a play, seek or speed change (15 s of grace, then the 6 s or 10 s hold: the button comes about 22 to 27 s after Play, and
about 33 s if Play was pressed during the 3-D spin-up, as measured on the real engine), while paused, with the app in the background, during the 3-D spin-up,
when replaying earlier results, after a rewind or an edit, and at Max speed (which asks for nothing). The old "Computing" badge is
not shown while the signal is.

**The sheet.** Tapping the button opens *Running slower than playback* (a bottom sheet; Back and Escape close it): what you asked
for against what this phone is computing right now, *Does it change the result? No*, where the time goes in the last 10 s (the 3-D
air, fire spread, embers, everything else), the likely reasons (each only when the numbers support it), two actions (*Play at N x*,
the nearest preset at or below what the phone achieves, which also becomes the default speed, as picking it in the speed sheet does;
*Use the fast model from here*, which restores the last checkpoint (one per 30 minutes of fire) and computes again, so its note says
*The fire is computed again from the last checkpoint, up to half an hour of fire ago, and comes out a little different*, and which is
hidden when the model is already fast), and *All the numbers*. It says *Pausing stops the simulation too. Playing slower is what lets
it keep up.* (a pause stops the worker, so it does not let the simulation run ahead). The sheet's *Fire spread* row includes the
coupling with the air. The sheet is a separate chunk, loaded on the first tap.

## Simulation debug statistics

Main menu, directly under Settings (also *Settings, Data and transparency*, Setup's *Area and detail* so a phone can be checked
before anything is built, the model card, and *All the numbers* in the speed sheet). It never opens by itself and never pauses or
changes playback; it refreshes once a second in place (so a selection survives), not while the app is hidden. Its 18 groups are
collapsed at first, each with a one-line summary: Summary, Run, Choices, Grids, Speed, Speed history, Step, Worker duty, Where the
time goes, Step quality, Embers, Re-runs, Memory, Display, Phone hardware, Phone software and graphics, What this phone can do, and
Recent events. **Copy** puts the whole page on the clipboard as plain text (a header with the time and the offset from UTC, the run,
the stable group titles, and an end marker so a cut-off paste shows); if the phone refuses, the text appears in a box to select.

**The speed test** (0.7.0, `src/ui/speedTest.ts`, `speedTestKernels.ts`, `speedTest.worker.ts`, `speedTestModel.ts` for the words; the optional button of plan section 5.3 and the 0.3.1 row, never built until now). *What this phone can do* has a fourth row, **Speed test**, and under it a button, **Run the speed test**, with a polite status line. It runs two frozen kernels for about 2 seconds in a throwaway worker: K1, an *air stencil* (a 7-point stencil and a trilinear gather for every interior cell of the standard tier's 45 x 45 x 20 grid, 40,500 cells, from a fixed LCG seed, never `Math.random`), and K2, a *memory copy* of 16 MiB of Float32; each is warmed for 0.2 s and timed for 0.8 s by whole sweeps. The result says how many million cell updates a second and how many GB a second this phone made and how many times slower or faster each is than `SPEED_TEST_REFERENCE`, with the test version and the time, and a caveat ("One short test on one thread: heat and other apps change it, so run it twice. It does not predict a run; the simulation's own measured speed is the better number once a run exists."). The reference is the same code on the build machine: **53.5 million cell updates a second and 4.26 GB a second**, the median of 12 runs in node 22.22 on one core of the shared 4-core container this app is built on (a Xeon at 2.1 GHz, load average about 5 from other work), under the heavy lock, on 2026-10-30 (the best run was 56.8 and 4.75, the spread about 8 %); a ratio over 1 means this phone is slower. Re-measure with `flock /tmp/firesim-heavy.lock env SPEEDTEST_REF=1 npx vitest run src/ui/speedTest.reference.test.ts`. The kernels are **frozen**: `SPEED_TEST_VERSION` is 1 and `speedTest.test.ts` pins the checksum of K1 after 3 sweeps and of K2 after 2, so an edit to a kernel fails a test and forces a new version and a new reference. **It never changes a result** (plan section 4, rules 1 and 2): it takes no input from the scenario, the engine or the clock beyond its own `performance.now()`, writes nothing the engine reads, and nothing reads its result but the statistics screen (`speedTest.deps.test.ts` fences it both ways: only the statistics screen and its content may import a speed test module, and the speed test imports nothing of the app; `e2e/speed-test.spec.ts` compares the snapshot hashes of a run that was tested while paused with one that was not). The button is off, with the reason in the status line, while a run plays or the engine is computing ("Pause first so the test is fair." and "The simulation is still computing. Try again in a moment so the test is fair."), while the app is in the background ("The app is in the background, so the test would not be fair."; a test running when the app goes to the background is stopped) and after a failure ("This phone cannot run the test here."); closing the screen terminates the worker and shows nothing; where `Worker` is missing or will not start, the same sweeps run on the main thread in slices of 8 ms, so a phone on the in-thread engine still has a test. The result is kept only in the row and in the copied text, not across launches. **Not measured: the test on a phone, and how fast the worker starts in the WebView.**

Every number is a measurement on this phone or a value the app was given, and says "Not measured yet", "No run yet" or "Not
available" rather than guess. The copy holds no coordinates, no custom place name and no identifier (a bundled site is named, any
other place is "a custom place"; error lines are stripped of links and long decimals), and sends nothing anywhere. The phone's
model, Android version and WebView come from User-Agent Client Hints where the WebView has them, else from the user agent, whose raw
text is always shown; a reduced user agent says "Hidden by the WebView" instead of a guess (`src/ui/deviceInfo.ts`, web APIs only,
no native plugin). The frame numbers are the last seconds before the screen opened, because the 3-D view stops drawing behind a
full-screen screen; a slow frame is one over 34 ms (the 30 fps playback cap draws 33.3 ms frames, which assumes a 60 Hz panel). The *Display* group also has one row for the cliff
drawing, once per scenario (see *Cliffs: what is drawn and what is simulated*). Some things are not counted and say so: the ember
totals read "Not counted by this engine", and where time goes per module the last 10 seconds show shares, not milliseconds.

What it costs the engine: the worker side (`src/sim/perfStats.ts`) is counters, running aggregates and rings of at most 128 numbers,
with no loop over cells and no per-step log; `src/sim/perf.test.ts` and `perfStats.test.ts` hold it to under 1 % of a step, under
16 KB retained in the worker and under 2 KB serialised per snapshot (the builder measured about 5 microseconds per step, about 11 KB
retained and at most 1.9 KB serialised).

## Night lighting and picture quality

**Night lighting** (*Layers, Map type, Night lighting*): *Realistic* (the default) follows the clock, so the night is dark, on
purpose: judging a fire at night is when trainees most often misjudge it. *Brighter* and *Daylight* light the ground, the
trees, roads and labels after dark from a fixed north-west sun 30 degrees up (so slopes show their shape; Daylight is not noon),
fading in over dusk from a real sun at +8 degrees to -2 degrees. By day all three are the same picture. The sky, stars, the fire's
glow, lit windows, the smoke and the fog keep the real clock. It applies at once (no rebuild, no pause), is remembered between runs,
and *Reset layers* returns it to Realistic. The maths is `mapLighting` in `src/render/sky.ts`; with Realistic it returns the real
lighting unchanged (a test).

**Picture quality** (*Settings, Simulation, Picture quality*): Auto, Low, Medium, High, for the next model you build. Auto picks
from the phone's cores and memory (High at 8 or more cores and 6 GB or more; Low at 4 or fewer cores or 3 GB or less; otherwise
Medium; a value the phone does not report counts as 4 cores and 4 GB; the browser's memory figure is a coarse bucket (0.25, 0.5, 1, 2, 4
or 8 GB), so in practice High needs a phone that reports the 8 GB bucket), except that the Detail performance profile asks for High.
A tier sets the terrain mesh, the trees, the canopy triangles, the pixel-ratio cap, the flame and smoke caps and how much rock detail the
cliffs get (see *Cliffs*, next):

| | Low | Medium | High |
|---|---|---|---|
| Terrain mesh (samples per side) | 224 | 320 | 400 |
| Tree instances | 16,000 | 32,000 | 48,000 |
| Canopy triangle budget | 100k | 170k | 250k |
| Pixel-ratio cap | 1.25 | 1.75 | 2 |
| Flame sites / smoke puffs | 2,500 / 800 | 5,000 / 1,500 | 5,000 / 1,500 |
| Trees sway by default | off | on | on |
| Rock detail on cliffs (kinds drawn, of six) | 3 | 4 | 6 |

The picture still lowers its own resolution while the frame rate stays under 30, whatever the tier. If High is chosen (or asked for by
Detail) on a phone the guess calls Low, Settings says so in a plain line and blocks nothing. The statistics screen shows the tier in
use, why, and what it sets. The memory estimate made while a model is built stays device-independent (it assumes Medium); the Data
sets screen re-sizes it for the tier actually running.

## Cliffs: what is drawn and what is simulated

**Drawn: a display-only look, always on.** With a 10 m terrain (every scenario the real builder makes has one, even where it is only
interpolated from 30 m heights; the demo engine's 2-D map has none and keeps the old drawing) the 3-D view draws steep ground as rock walls. There is no setting and no
data-faithful mode, and every picture-quality tier has it: the tier only trims the detail. The ground height data is a stereo-derived
model in which a face reads as a steep slope, and the old mesh blurred it to a ramp, so it was drawn as a rounded curtain. The new
drawing is one pipeline (`src/render/cliffDrawing.ts`, pure, run once per scenario when the view is set up):

1. **Sharpen** (`cliffSharpen.ts`). Cells are weighted by `smoothstep(48, 62)` of their 3 x 3 Horn slope, in degrees (the weight is
   spread to the eight neighbours at 0.6 so the shoulders move too). Each weighted cell moves towards the nearer of the lowest and
   the highest height found up to 3 cells (30 m) either way along its own fall line, so a straight ramp and all ground under
   48 degrees are left exactly as they were and a gully stays a slot. A despike pass then pulls any cell that stands 10 m or more above
   or below all eight neighbours back to just past them. On the whole bundled 9 km Katoomba terrain 3.9 % of the 10 m cells move (6.1 % at Tomah),
   by 19 m on average at Katoomba and by up to about 120 m at Kanangra and Grose, where a face collapses to a step (measured with the
   shipped function).
2. **A mesh that keeps the edge** (`terrainMesh.ts`, `decimateTerrain`). Under 40 degrees it returns exactly what the old
   `decimateGrid` returned; where a vertex's footprint holds ground steeper than that it blends to the unblurred sample (fully at
   55 degrees), so a step stays a step between neighbouring vertices. The finished mesh is despiked (10 m at High and Medium, 18 m at
   Low). For a 9 km area the mesh cells are 22.5, 28.2 and 40.3 m at High, Medium and Low (400, 320 and 224 samples a side).
3. **Light from the 10 m ground.** The shader's normals come from a Horn-gradient texture of the sharpened 10 m terrain (RG16F; the
   fire grid's gradient stays as the fallback when there is no 10 m terrain), and the hillshade, sky-view factor and cast shadows
   are computed from the sharpened mesh, so cliff shadows sharpen too. The slope that decides banded rock against the aerial photo is
   the **mesh's own** (a per-vertex attribute, `aSlope`, one `varying`), not the 10 m one: the two disagree by up to a vertex
   spacing and the photo-against-rock switch would draw that disagreement as spikes along the lip and the foot.
4. **A rock mask** (`rockMask.ts`; an RGBA8 raster on the 10 m grid, sampled in the shader as `uRock`): R is bare rock, from the mesh
   slope with a band lowered by tier (48 to 58, 45 to 55 and 42 to 52 degrees at High, Medium and Low, because a coarser mesh
   reads a face gentler) and the canopy cover, which fades out on walls (the canopy raster is a top-down 20 m product and cannot see a
   face); G is scree (a 22 to 40 degree slope with rock within 80 m uphill); B is lip pavement (under 15 degrees with rock within
   40 m). A one-byte copy of R stays on the main thread for tree placement.
5. **Rock detail in the terrain shader**, only where R is above 0.25 (G and B above 0.05), faded by the pixel-size terms the strata
   already use so nothing shimmers in wide views: **ledges** (a stepped profile that tilts the normal as well as the colour),
   **vertical joints**, **overhang bands** (darker ambient under each ledge), **water stains**, **scree** and **lip pavement**. High
   draws all six, Medium four (no joints, no overhang bands), Low three (ledges, stains, scree). Under the Plain map type or a solo heat
   map only the normal is perturbed, at 40 % of its strength, so an overlay reads on the shape of the land.
6. **Trees stay off bare faces.** A tree that would stand where R is 0.5 or more is drawn again within its cell up to three times and
   then left out; between 0.2 and 0.5 the trees thin out to none.
7. **What follows the drawn ground follows the drawing**: picking, the camera clamp, flames, smoke bases, labels and roads are
   placed on the sharpened mesh, so they sit on what you see. The fire, fuel and aerial photo textures stay on their own coordinates:
   only heights change, so nothing is shifted sideways. Vertical exaggeration multiplies the sharpened heights as before, and night
   lighting shades rock like any ground.

**Not simulated: every number uses the terrain as received** (ground rule 10 of the plan: a drawing may be stylised, a number may
not). The simulation, the slope and elevation overlays, the explanation cards and the Data sets statistics never see the sharpened
ground, and the Sunlight (insolation) heat map, which is computed in the view, is computed from the 10 m terrain as received on the
old mesh, not from the drawing. The Data sets Terrain card says so: *Cliff faces are drawn steeper than the data so they read as
rock walls. Fire, wind and slope numbers use the data as received.* Help has an entry, *Cliffs and rock*.

**What the fire model does with steep ground (unchanged in 0.3.0).** It does not read the drawing. A fire cell is a wall (the
surface fire cannot enter it) if its landform is Cliff, that is a slope over 45 degrees on the fire grid, whose cells are 20 or 30 m, or
if at least 30 % of its 10 m sub-cells are steeper than 60 degrees, or if the 90th-percentile sub-cell slope is 60 degrees or more
(`computeTerrainFeatures`, `src/fire/terrainFeatures.ts`); fuel inference calls ground over 55 degrees or half sub-cell cliff
non-fuel as well. Embers do not read the wall mask and still cross it. This rule makes no difference between bare rock and steep
forest, and it is not the same set of ground as the drawn walls: the drawing steepens from 48 degrees on the 10 m slope, the model's
wall follows the mean over a fire cell. So fire can cross ground that is drawn as a wall, and a steep forested slope can be a wall in
the model without being drawn as rock. Making a wall mean bare rock, with part-rock cells that slow the fire and vegetated chutes
that stay open, is the plan's second half (H-sim); it is **not in 0.3.0** and is planned for 0.3.1, so results near cliffs are the same
as in 0.2.2.

**Limits.** A face under about 60 m high is below what a 22 to 40 m mesh can show and still reads as a steep bank; the lighting and
the rock detail carry it. The despike also clips real single-vertex summits and pits that stand 10 m or more above or below all eight
neighbours: on the High mesh a vertex moves by up to 26.6 m at Katoomba and 42.5 m at Grose (the highest point of each of the four steep sites is within about half a metre of the data's, as it was with the old
mesh). No phone has been measured: see *Known limitations*.

**What it costs.** The pipeline ran in 150 to 450 ms in node for Katoomba and Tomah on the three tiers (a loaded 4-core machine; the
plan's guess for a phone is 2.7 to 5 times that, not measured). The triangle count of the ground does not change with it (a mesh of
400 x 400 samples has 318,402 at High, 203,522 at Medium with 320 and 99,458 at Low with 224) and the draw calls do not change
(`e2e/cliffs.spec.ts`). The terrain shader gains one texture (`uRock`, the 11th of 16 fragment units), the `aSlope` attribute and the
defines `CLIFF`, `RD_LEDGES`, `RD_OVERHANG`, `RD_JOINTS`, `RD_STAINS`, `RD_SCREE` and `RD_PAVEMENT`. Memory, as three rows of the Data
sets screen's working memory: for a 9 km area (810,000 cells of 10 m) 7.9 MB on the screen thread (the rock copy, 0.81 MB, and the arrays
Three.js keeps behind the two textures and the mesh's slope so it can restore them after a lost graphics context, 7.1 MB) and 7.1 MB on
the graphics side (the lighting gradient 3.2 MB, the rock mask 3.2 MB and the mesh's slope 0.64 MB at High), plus about 13 MB held
while the scenario is set up and then released. The render chunk grew by about 7.5 kB gzipped (+19 kB raw) and the entry by about 0.4 kB.

## Air slices and the air picture

**What it is.** *Tools, Air slices* shows a vertical slice of the air along a line you choose, from the side, in a flat panel above the
timeline (a Canvas 2-D drawing, `src/ui/screens/sim/slicePanel.ts`) and as a curtain in the 3-D view. The tool has two
tabs, *Side view* and, since 0.5.0, *Map view* (the wind arrows and flow lines on the map, *The two tabs*, below). It works on every run, because since 0.4.0 both tiers publish a 3-D wind for it
to read (see *The air view*, below). It only reads the air: nothing it does reaches the simulation, so the fire is the same with a
slice on or off. The 2-D demo map (`?mock=1`) has no air, so the tool there says "The side view needs the 3-D view."

**Placing a line.** *Set start (A)* shows the cross; slide the map under it with one finger and tap *Place A here* (a tap on the map
sets a dashed mark and *Place A here* then keeps that point, the two-step confirm for gloves and wet screens); then *Set end (B)* and
*Place B here*. That is four taps for a line of your own and two for a preset (*Presets*, then one of the four). *Swap* turns the line
round. A and B are written together or not at all, so a half-placed line is never drawn. A preset is a line through the fire (the
middle of the map when there is no fire yet, and the line then says "No fire yet: centred on the map"), about 3 km each way, cut to the
model rectangle ("Shown to the edge of the model area"):

| Preset | A to B | It cannot be used when |
|---|---|---|
| Along the wind | A upwind, B downwind | the wind is calm (the model's at the middle of the line and the forecast's): "The wind is calm, so it has no direction yet" |
| Across the wind | the wind blows to the right of A to B (so "Across" reads positive) | the wind is calm |
| Up the slope | A downhill, B uphill, from the ground's slope over about 2 km | the ground is flatter than about 2 degrees: "The ground here is too flat to have an uphill direction" |
| Me to fire | from your phone's position to the fire (not extended) | there is no position inside the model area ("This run has no position for you", "You are outside the model area") or no fire yet ("There is no fire to go to yet"); the button stays off, with that reason under it, until there is both |

A preset is live: it is worked out again from the wind, the fire and the phone every time the slice is computed, so *Along the wind*
follows a wind change while the run plays. The wind it follows is the model's own, at the middle of the preset line (the fire, else the
middle of the map), 30 m above the ground there, because that is the air the slice shows and the Along and Across chips are about. The
forecast's 10 m direction at the time shown is only the fallback, for air that holds no 3-D wind or a model wind there under 0.2 m/s.
After a wind edit the two can differ by tens of degrees (an edit of 14 m/s from the east at the fire gave 12.7 m/s from about 95 degrees
at 30 m while the forecast still said the weather file's north-westerly), and the line now follows the edit. The shortest line is the
larger of 300 m and two model cells; shorter
ones are refused in words ("Make the line longer than 300 m", the number rounded up to 50 m). Back and Escape drop a placement under
way first and close the tool next, and focus returns to the Tools button; one-finger pan keeps working while placing. The line, A and B
are written to the layer state (`LayerState.crossSection.a`, `b`, `preset`, `field`; nothing is remembered between runs) and drawn on the
map as marks (A, B, the line and the probe's pin).

**The side view.** Height is metres above sea level, up the picture; distance from A is along the bottom, A always at the left. The
slice is sampled on a lattice of 48 to 192 columns (one per half model cell of the line) and 48 to 56 rows, from 50 m under the lowest
ground on the line to 2,000 m over the highest or the model top. It draws:

- the **field** as a smoothed raster, or, with the *Show model cells* switch (off at first), one block for each cell the line really
  passes through with the model's own value in it, nothing blended;
- the **ground** as a filled shape from the 10 m terrain as received (never the sharpened cliff drawing) and the ground **as the model
  sees it** as a dashed line, which is smoother, so a cliff the model smooths away shows only in the filled shape;
- **axes** (ticks at 1, 2 or 5 times a power of ten, chosen by a pure `niceTicks` to give about five, for example every 500 m of height, and distance in metres or kilometres) and a small tag, "True scale"
  or, for example, "Height ×1.5", for the scale actually drawn: true scale times the existing *Vertical exaggeration* slider (1 to 3) of
  Layers, reduced when the box is too short for it;
- **flow streaks** (about 600 particles moving with the along-line wind and the vertical motion, at most 24 frames a second on any
  display, so a 60 Hz screen draws 20, a 120 or 144 Hz one 24; stopped while the panel is hidden, covered or the page is in the
  background), or, when the phone is set to reduce motion, a still lattice of arrows. **Since 0.6.0 both are about twice as dense** (the owner asked for the side
  view's wind marks twice as dense): a plot gets one streak per about 95 square px, at most 600 and at least 120 (0.5.0: 300, one per 190), and the still arrows
  sit on a lattice of about 24 x 21 px a cell (0.5.0: 34 x 30), the longest arrow 60 % of the smaller side of its cell, about 7 to 13 px on a phone (0.5.0: 10 to 18 px). The slice's verifier measured it on the real app: the streaks exactly 2.00 times as many, the arrows 1.6 to 2.3 times, and the arrows 29 to 42 % shorter (a calm arrow 7.8 to 8.7 px on a portrait phone and 6.5 to 6.9 px on a landscape one, about 17 device px at a pixel ratio of 2.625). **Since 0.7.0 a calm arrow has a floor of 8 px** (`ARROW_MIN_PX` in `arrowLength`: `max(min(8, longest), 55 % to 100 % of longest)`), never longer than the cell holds, so the longest arrow's rule stands (at 8 px in a 21 px cell the clear air between two neighbours is 38 % of the side against the 40 % the longest arrow leaves) and strong arrows do not change: an arrow is 8 to 13 px on a phone;
- the **probe**: tap or drag on the picture (or use the arrow keys on the focused picture; Escape or the small X clears it) and one
  sentence reads the air there, for example "Wind about 32 km/h from the north-west, along the line 28 km/h towards B, up 1.4 m/s, 60 m
  above ground, 3 K warmer than average", with a pin on the map. Points inside the ground, below the model's own ground or above its top
  get a short sentence that says so;
- the **chips**, a legend and the **footer** (below).

| Chip | Colours the slice by | Needs |
|---|---|---|
| Speed | the sideways wind speed, 0 to 90 km/h | a 3-D wind (both tiers) |
| Along | the wind along the line: purple towards A, green towards B | a 3-D wind |
| Up/down | air rising (warm colours) or sinking (cool colours), -4 to +8 m/s | a 3-D wind |
| Across | the wind across the line: purple towards the left, green towards the right of someone walking from A to B | a 3-D wind |
| Temp | warmer or cooler than the average of the slice at that height, in kelvin (-10 to +20 K) | the 3-D atmosphere |
| Smoke | the model's smoke concentration on a **log scale**, four steps of ten from 0.0001 to 1 | the 3-D atmosphere |

On the fast tier Temp and Smoke are off with the reason in words and a *Use the 3-D atmosphere* button, which switches the run over (it
restores the last checkpoint and computes again). Along and Across share one diverging ramp, pale at zero and darker with the size of
the wind; wind direction is always reported as where it comes **from**, with the hyphenated eight-point word ("north-west"). The footer
is always in view: **kind · model grid · age**, for example "3-D time-stepped air · model grid 133 m · air from 11:25" or "Diagnosed wind:
terrain effects only · model grid 133 m · air from 11:25", and "(4 min before the time shown)" is added when the air is more than 90 s
older than the picture. That is usual, not rare: only the newest picture of a run has air made at its own time, every earlier one is composed
from the saved air at or before its time. Where the history has room (a 2 GB phone, for a 6 hour run) the air is saved about every 5 minutes (the history's
keyframes), so the footer can say 2 to 5 minutes while the run plays at 60 x (as seen when the build was checked), and not only after
jumping back. On a 0.5 or 1 GB phone the fast tier's saved wind is thinned to a share of the history's memory once that fills (see
*Memory* below), so after hours of run the air of an old picture can be hours older than the picture (up to 239, 119 and 129 minutes
at 48, 61.4 and 64 MiB over 6 hours, measured), and the footer says exactly that, in minutes. Where the line is recorded (*Recording a line*,
below) and the time shown falls inside the recording, the footer says "recorded air from 11:25" and counts the age from that picture, which
is never older than about the recording's spacing.

**On a short screen.** In short landscape (844 x 390) the picture (84 px high, as wide as the panel) and a one-line footer stay pinned;
the reading of a probe, the chips and the controls scroll between them, so with a reading on, the chips, *Presets* and the 3-D button can
still be reached (the footer gives its line to the reading while there is one, and a new tap on the picture scrolls back up to the
reading). **Since 0.7.0** the tool's body keeps `scroll-padding: 96px 0 52px` there (it was 30 px), so a control scrolled to the middle clears a footer of two lines (the 3-D tier with a recording): with the old reserve the real-engine tap audit at 844 x 390 with a recording measured 3 of 8 bottom probes missing for 7 controls on the 3-D tier and none on the fast tier (a body of 190 px, a footer of 29 px on the fast tier and 49 px on the 3-D tier). The cause was the pinned footer, not the compass button that 0.6.0's notes named; 48 px clears the 49 px footer by 2 px and 52 px sits in the middle of the window that the two constraints leave (46 to 58 px). In portrait the order is the picture, the reading, the chips, the *Use the 3-D atmosphere* button (a row of its own, only while a chip is off), the controls, then the words of the chips that are off, then the legend (on the 3-D air there are no notes and no button, and the legend comes before the controls). **Since 0.7.0 the button sits directly under the chips**, beside the thing it explains (the owner accepted that recommendation of 0.5.0): at 412 x 915 the button, *Set start*, *Set end*, *Swap* and *Presets* are in view with no scroll; at 390 x 844 everything but *Presets* is (the chips are in two rows and the sheet is 71 px shorter, so *Presets* is about 38 px under the pinned footer at the top scroll: the orchestrator's figure, not re-measured by the docs lane); at 360 x 640 and 844 x 390 the button is one short scroll away, as before, and a tap on a chip that is off scrolls to it (the scroll keeps 52 px clear of the footer, below). The first build of 0.7.0 moved the whole block, the button and the words, under the chips; the real-engine verifier found that pushed *Set start* behind the footer at 412 x 915 and hid *Presets*, so only the button moved and the words stayed under the controls, as in 0.6.0 (owner question 6, decided by the orchestrator). In the Layers panel the callout was already directly under its chips and is only pinned by a test. After a long session the sheet is 76 px shorter than in a fresh one (the footer at 726 px, not 802) and the controls and the button are not all on screen then; the cause was not found. Under 412 px wide the six chips sit in two rows of three. The picture is as tall as it needs to be (at most
180 to 230 px, 27 % of the screen height within those limits), so a long line at true scale has no empty band above it.

**The curtain** is the same slice standing over the terrain in the 3-D view. The scene computes the slice once (`SliceUpdater`,
`src/render/slice/sliceUpdater.ts`: at once for a new line, chip or layer change, otherwise at most every 250 ms after a new picture
of the air) and both the curtain and the panel read that one result, so they cannot disagree. The curtain's colours are the slice's
lattice, drawn with the same ramps as the panel and the legends; its wind arrows still read the sampler at 21 columns by nine heights (about twice as many as the 15 by six before 0.6.0)
(30 to 2,200 m above the ground; for a recorded slice they read its lattice instead, so they agree with its colours), and the cyan arrows
that mark air blowing against the main wind are drawn on the 3-D atmosphere only. **Thinned where the curtain is seen edge on** (0.7.0, F2, `curtainArrows.ts`, pure; `CrossSectionLayer.setView(camera, viewportH)` is called every frame next to the slice poll): when the camera looks along the section line the 21 columns land on one screen column and their heads stack, so only every `stride`-th column is drawn, 1 to 7 (`MAX_STRIDE`), the same columns at each stride, chosen to keep the drawn columns 14 px apart (`ARROW_MIN_SPACING_PX`) with 15 % hysteresis on the gap so a small camera move cannot flip it; the batch and its halo are committed again only when the stride changes. The foreshortening is the sine of the angle between the way the camera looks across the ground and the line (1 face-on or from straight above, 0 along it, **whatever the tilt**: a curtain is a vertical plane, so looking along its line from any height sees it edge on; the first form counted the tilt and kept every column at the orbit's usual 35 degrees, where on a 360 x 640 screen 731 pairs of heads stood on each other along a 6 km line against 12 after the fix). Seen face-on all 168 arrows (21 by nine) are drawn. Display only; the 14 px is a tuning number that a person judges on a picture (`e2e/wind-motion.spec.ts` attaches them).
With no chip chosen it keeps its old colouring (temperature on the 3-D atmosphere, wind speed on the fast tier); the first line you place
chooses Speed. The Layers panel has the same six chips under *Air slice*, and, on the fast model, a note: "This section shows the diagnosed
wind (terrain effects only). Use the 3-D atmosphere to see the plume, temperature and smoke." In that panel the chips are headed *Colour the
slice by* and the compass is *Slice direction*. With a line placed by the tool (or a preset) the compass shows that line's own bearing, and
turning it swings the line about its middle, out to the edges of the model area (the line is then the compass's, no longer a preset or
A and B); *Centre on the fire* moves the line to the fire at the same bearing, and a hint above the compass, shown while a line is placed, says so. A probe on the old line
is cleared whenever the line is changed from outside the tool (the compass, *Centre on the fire*, *Show me*). Since 0.4.1 the compass hint also says
"Turning the compass or Centre on the fire starts a new line, so its recording is dropped." and the slice's switch says "Switching the slice off
clears its recording." One sentence of the Layers
panel still says "section", the diagnosed-wind note above.

**Recording a line** (0.4.1, plan section 8.6 and decision D7). The air saved behind an older picture is up to 5 minutes older than the picture,
and on a small phone hours older (see the footer, above). The recorder removes that for one line: from the moment the line is placed it samples
the slice of that line at every picture the simulation makes, on the same lattice the live slice uses, keeps it as small integers, and the side
view reads it back for the time shown. `SliceRecorder` (`src/render/slice/sliceRecorder.ts`) holds the samples and `sliceTimeLapse.ts` is the
scene's half: it samples, and it is also the reader the slice updater asks first. It only reads. Nothing in the simulation reads the recorder, and
the snapshot's hash is the same with and without a recorded line (a real run of each tier, in `sliceTimeLapse.test.ts`; run B of the determinism
test in `e2e/robustness.spec.ts` keeps a preset and records, run A has no slice at all).

*Which line.* One hand-placed line (A and B, set with the cross or a tap). A live preset, and the Layers panel's compass line, are **not**
recorded: they move with the wind and the fire (or with the compass), so there is no one line to record, and the status line says so ("This
preset follows the wind and the fire, so it is not recorded. Press Keep this line to record it."; "The Layers line is not recorded. Place a line
with Set start (A) and Set end (B) to record it."). **Keep this line**, a button of the tool shown only while the line is a live preset
(`keepLine` in `sliceToolModel.ts`), writes the preset's line as A and B, clears the preset and the probe, and the recording starts with the next
picture. **Clear recording**, shown only while something is recorded, empties the recorder (the line stays) and the screen reader hears
"Recording cleared. Recording starts when the simulation next runs." The two are not on screen together (a preset has no recording), and they sit 4 px under the other
buttons of the tool (a 2 px gap let their 44 px hit areas fight in the repo's tap audit). Both put focus on the status line, which is a
paragraph with `tabindex="-1"` and not a stop of the Tab key, so that the answer scrolls into view clear of the pinned footer.

*What drops a recording* (the status line says why, in the words of `src/ui/recordingWords.ts`):

| What happens | What the recorder does |
|---|---|
| A or B moved or swapped, a preset chosen, the Layers compass turned or *Centre on the fire* | the line's key (both ends rounded to 0.1 m, `sliceLineKey`) is another one, so the recording is dropped at once, even while paused (`follow`, called when the scene applies a slice): "The line changed, so the old recording was dropped." |
| The slice switched off in Layers, a new scenario | forgotten without a word (nothing is shown then); switching on starts from nothing |
| *Clear recording* | emptied; "Recording cleared." stays until a picture is held again |
| The air model gets another lattice | the earlier recording is dropped: "The air model changed, so the earlier recording was dropped." The standard and the fast tier are built on one atmosphere grid, so *Use the 3-D atmosphere* keeps the recording (each sample keeps its own kind of air); the High tier's grid is finer and starts another |
| An edit made in the past, a what-if, a solver-step change, undoing an ignition, the worker restoring a checkpoint | the samples after that time go, and are recorded again as the run is computed again (*one place the history is cut*, below) |

*Where it starts, and why not earlier.* The recorder is fed from `SimSession.onSnapshot`, that is every picture the worker makes, and not from the
picture on screen (the scene sees only a composed, rounded picture). The worker computes ahead of the view (`runTarget`: the view time plus the
largest of three display steps, 30 times the playback speed and 1,800 s, so 3,600 s, an hour, ahead at 120 x), so a line placed while the run
plays is recorded from where the worker had got to, which can be well after the time shown. Nothing is filled in retroactively: the checkpoints and
their ring are private to the worker, and filling backwards would need a second simulation. The status says from when the recording runs and, for
a time before it, that the picture uses the history's saved air as in 0.4.0:

| State | Status line (under the controls) |
|---|---|
| Recording, the time shown inside | "Recorded from 11:30 to 12:40 (every picture kept)." or "(about every 2 min)." (seconds under 90 s, hours from 90 min) |
| The time shown is before the first picture | "Recorded from 13:06, as far ahead as the simulation had run. This time is earlier, so it uses the history's saved air, which can be older." |
| Nothing recorded yet | "Recording starts when the simulation next runs." |
| After a drop | the reason first ("The line changed, so the old recording was dropped."), then "Recording starts when the simulation next runs." while nothing is held and "Recording again from 12:45." (the span, once it has grown) when a picture is |
| The recorder failed | "Recording stopped. The slice is not affected." (the slice is never lost to the recorder; nothing is logged) |
| *Show model cells* on a recorded slice | "The recording does not keep the model's own cells, so the smooth picture is shown." |

*What the side view reads* (`SliceUpdater.compute`, `SliceRecorder.read`). The recorded slice replaces the one sampled from the picture's own air
only when the line key and the kind of air (3-D or diagnosed) are the recorder's, a sample exists at or before the time shown, and that sample is
more than half a second newer than the air the picture itself carries. So the newest picture of a run, whose air is its own, stays live and
exact; an older, composed picture takes the recorded air; before the first sample, after a line change and on the other kind of air it is the
0.4.0 path, unchanged. The footer then says "recorded air from 11:25" (with "(2 min before the time shown)" past 90 s, counted from the sample).
The probe, the streaks, the legend and the chips read the same `SliceData`, so nothing else changed. Against the picture's own saved air at the same
time the differences were the 2 to 3 minutes the air really moved (on the fast tier 0.01 to 0.03 m/s of 17.5; the 3-D air's speed 0.05 to
0.24 % rms; a verifier's measurement, real engine).

*How a sample is kept* (`src/core/sliceRecording.ts`, reusing the idea of `airPack.ts`). Each field is a signed 16-bit integer with a scale of its
own (`q = round(f / s)`, `s = max|f| / 32767`): along, across and up (6 bytes a lattice point) and, on the 3-D air, theta and smoke (10 in all).
Every value comes back within 0.502 of a step, 0.00046 m/s at 30 m/s. The speed is not stored: it is `hypot(along, across)`, because along and
across are the wind turned by a unit vector. Smoke spans four decades on the legend's log ramp, which a linear code would put on three steps, so it
is a log code: within a relative 3.3e-4 from 1e-6 to 1e3, and 0 below 1e-6. What does not change from one sample to the next (`valid`, the two
grounds, the height axis) is kept once for each *epoch* (a line on a lattice: 5,772 B at 90 x 54). The model's own cells are not kept.

| Line (its lattice) | A sample on the 3-D air | A sample on the fast tier | Samples that fit in 12 MiB (3-D air / fast tier) |
|---|---|---|---|
| A 6 km line on the 133 m grid, 90 x 54 | 48,696 B | 29,256 B | 258 / 429 |
| The longest line the app can make on the standard or fast tier, 127 x 56 | 71,216 B | 42,768 B | 176 / 294 |
| The same on the High tier, 170 x 56 | 95,296 B | 57,216 B | 131 / 219 |

(`sliceSampleBytes` and the epoch's bytes, printed by a throwaway test of the real functions; the 90 x 54 row is also printed by
`npx vitest run src/render/slice/sliceRecorder.perf.test.ts`. The design's longest line, 192 x 56, cannot occur: a lattice has one column for each
half model cell and the model cell is never under 100 m, so a line at most as long as the model's diagonal has at most 127 columns on the standard and
fast tiers and 170 on the High tier, whatever the area is.)

*Thinning.* When a stored sample would take the recording over its budget, every second sample goes and the gap that the recorder asks for between
pictures doubles; the first and the newest picture always stay, and a newest picture that would have gone takes the place of the last one kept,
so no two are closer than the gap. The first gap is twice the **median** spacing of what was stored, not the least: the least let one picture taken a
few seconds after another (the run-end picture of a pause) set it, and the status then said "about every 5 s" of pictures that were 2 minutes
apart (and every later thinning doubled both, so it never came right). The thinning is uniform and not oldest-first (the history's rule) because the recorder is there to replay how the air changed since the line
was placed: an even spacing gives one number to say ("about every 2 min"), bounds the age of any read by it and is easy to test; the price is
that the newest minutes are no finer than the old ones. At 258 samples a 60 s display step is not thinned for 4.3 hours of run.

*Budget and memory.* An eighth of the history's budget, at most 12 MiB: 6 MiB at the history's 48 MiB floor, 7.7 MiB at 61.4, the full 12 MiB from
96 MiB (a phone of about 1.6 GB), **on top of** the history. `snapshotStore.ts` has no change in 0.4.1 and a test says so: scrubbing back keeps
the same number of pictures as in 0.4.0. The session tells the recorder its history's budget when it is made (`setHistoryBudget`, an optional
member of `SliceRecordingApi`). The recorder keeps a free list of the arrays of dropped samples for the next sample of that size (held to what the
budget has room for), so a steady stream allocates nothing and the recording never holds more than its budget; the statistics row counts the live
samples only (a verifier saw 12.4 MB held while the row said 6.7 MB). The Data sets memory model adds one note ("An Air slices recording adds up to
X while a line is recorded; it is not in the figures above.") and no row, so its totals do not change. The statistics screen's Memory group has
the row **Air slice recording**: "Off", "Waiting for the simulation to run", "42 slices, 2.0 MB of 6.3 MB" with its note "Recorded from
11:30 to 12:40 (about every 2 min); 3-D air; 48.7 KB a slice" (the example of `debugStats.test.ts`), or "Stopped"; the app prints sizes in
decimal kB and MB, so 6 MiB reads 6.3 MB and 12 MiB 12.6 MB. The model card's note on this phone says "an Air slices recording adds up to 6.3 MB
on top of it" at the 48 MiB floor.

*One place the history is cut.* The history and the recorder must keep the same time order. `session.ts` has one private `cutHistory(t)`, which
cuts the store and the recorder at `t` (keeping everything at or before it), and calls it at the five places that used to call
`snapshots.truncateAfter`: an edit made in the past (`prepareEditAt`), a what-if (`rerunWith`), a solver-step change (`rerunFromView`), undoing an
ignition (`removeIgnition`, at the ignition's own time, which can be well before the view time) and the worker's `rewound` (`onRewound`, not at all when
its early return applies). A source-audit test checks that there is exactly one such call. A new snapshot also cuts both by time order
(`SnapshotStore.push`, `SliceRecorder.arrive`), which is how a tier switch and a replay invalidate stale samples: the worker says `rewound` and
sends the pictures again. `onSnapshot` feeds the recorder after the store has the picture and `dispose` clears it. With the real engine
(`session.recorder.sim.test.ts`) the recorder and the history agree picture for picture, to the packing bound, after each of those operations.

*What it costs.* In node, one run each (`npx vitest run src/render/slice/sliceRecorder.perf.test.ts`): arriving, sampling and storing a picture of
a 90 x 54 line took a median of 0.95 ms and a 95th percentile of 1.23 ms on the 3-D air (0.63 and 0.71 ms on the fast tier), a read a 95th
percentile of 0.065 ms, the store that thins a median of 0.25 ms, and the whole `record(snapshot)` path on 96 x 56 a median of 1.00 ms and a 95th
percentile of 1.31 ms; 3,000 arrivals, thinning included, changed the heap by 70.7 kB. In a real browser in software rendering under a 4x CPU
throttle at Max speed on a 6 km line (a verifier's measurement, not repeated by the docs lane), `record()` took a median of 3.8 ms and a 95th
percentile of 13.2 ms (maximum 22 ms) on the fast tier, where 14 pictures arrive each second and the recorder took a mean 6.7 % of the time (worst
second 132 ms), and 4.7, 11.1 and 29 ms on the 3-D tier, where 5 arrive each second (2.7 %). It is highest in the first 20 to 50 seconds after
*Keep this line*, and falls as thinning halves the rate at which pictures are stored; a single call can exceed the 16.7 ms of a 60 frames-a-second frame.
With the slice off, or a preset, it costs 0.03 to 0.1 ms and stores nothing. None of this was measured on a phone. If frame drops show up in
the first minute after *Keep this line*, the next step is to sample in idle time or to cap the pictures stored per wall second.

*Limits.* A line placed while playing is recorded only from the simulation's head (above). The recorder's cost at Max speed is a main-thread load of
the first minute. Nothing was seen on a phone. The "about every N min" wording needs 4 hours of run to appear and is unit-tested only, and so is the
"Recording stopped" state. `record()` and `follow()` take the line's key from different pictures' grids, which could flap for a line clipped by
the model's edge when the pictures of one session had two different grids; that cannot happen in the shipped UI. *Clear recording* has no undo. TalkBack
may read the status line (focused) and the polite announcement twice (not checked). In short landscape (844 x 390) the footer is hidden while a
probe reading is shown (the 0.4.0 rule: the reading takes its line), so nothing in view says "recorded" while probing; keeping the footer would clip
the reading, and a word added to the reading would lengthen it at 360 x 640, so it was left (at 360 x 640 in portrait the footer stays).

**The two tabs and Turn off the slice** (0.5.0, plan section 20). The tool's header has two tabs, *Side view* and *Map view*, a real tablist (`role="tablist"` and
`tab`, `aria-selected`, only the chosen tab in the Tab order, Left, Right, Home and End to move, a tabpanel named by the chosen tab, a polite announcement:
"Map view: wind arrows and flow lines." or "Side view."), in the segmented control's look, in the header where the subtitle "Side view" was (the header is no
taller, at most 50 px at 412 x 915, 360 x 640 and 844 x 390; under 400 px the title gives up its icon so that the two words fit). The *Map view* holds the
arrows' switch (named "Wind arrows and flow lines" there, with one line while it is off: "Draws the wind on the map: arrows from far away, flow lines when
you zoom in."), the *Wind height* chips, the caption and the zoom line, the very controls of Layers (*Wind arrows and flow lines*, below), so the two are one
setting: flip it in one, open the other, and it is the same. The side view's panel and its streaks are taken out of the document and stopped while the Map
view shows; a tab press drops a placement under way (no crosshair is left on the map); the tab you chose is kept when you close and reopen the tool; on the
2-D map the tool is one line and has no tabs.

**Turn off the slice** is the last button of the side view's controls and of the Map view (`slice-off`, a plain secondary large button, the row pattern of
*Keep this line*, no new CSS: `slice.css` is 4,066 bytes under a guard of 4,096). One press (`turnOffSlice` in `sliceToolModel.ts`, written through the
tool's one `apply`) sets the section off and clears its stored line (`a` and `b` unset, `preset` null; the colour chip and the Layers compass setting stay) and
the tool's placement, tapped candidate, draft end and probe; the one write to the layers clears the curtain, the panel's slice, the A and B marks and the
probe's pin on the map, **and the recording**, and the Layers panel reads Off. The tool **stays open** on its empty placement state, and focus goes to *Set
start (A)* (side view) or to the arrows switch (Map view), because the pressed button is put away. The polite announcement is "Slice turned off." or, when a
recording was held, "Slice turned off. The recording was cleared." While the recorder holds a picture a hint under the button reads "This also clears the
recording." (the button points at it with `aria-describedby`); there is no pop-up, no confirmation and no undo, so the hint is the whole safeguard. The
button is **absent** (hidden, not disabled) when there is nothing to turn off, while a placement is under way and when only one end is set (a draft end is
not a slice: the row made the sheet grow by 72 px after "Place A here" and moved the cross), and shown for a live preset, a hand line, the Layers panel's
line and a line that Layers switched off but the tool still holds. It is **not** the same as the Layers panel's own switch-off, which keeps the line (so
opening the tool brings it back) and clears only the recording, and **closing the tool** (X, Back, Escape) still does not turn the slice off. Why it stays out
of the 3-D map beside the line: the marks are in an `aria-hidden` layer with no hit targets, and a 44 px target there would fight the one-finger pan and the
tap-to-place candidate. Pictures 40 and 41 show both tabs with the button and its hint.

**The air view** (workstream C). Every picture the engine sends carries `atmosphere: AtmosphereView`, and since 0.4.0 it says what it is:

| Field | Meaning |
|---|---|
| `layout` | `'terrain-following'`: the model's own arrays, not resampled onto flat levels (older or hand-made views have `'flat'` or nothing, which counts as flat) |
| `kind` | `'prognostic'` (the time-stepped 3-D air: wind, temperature, smoke), `'diagnosed'` (the fast tier's fitted wind: wind only), or nothing (`nz > 0` means prognostic, otherwise `'surface'`) |
| `topM`, `baseM` | the model top above the datum, and the datum's height above sea level (the lowest ground), so no consumer has to estimate it |
| `time` | the simulation time the air was made at, which is what "air from 11:25" says |

The 3-D tier's `view()` ships fresh copies of its native arrays (nothing resampled, no zeros under the ground). The old flat view blended
the zeros under the ground into every sample near a hill: a test over a 700 m ridge shows it reading up to 96.4 % low at 30 m above the
ground (33 % on average across the ridge). The fast tier's `view()` now carries the stamp-blended wind it already had inside, the *diagnosed
wind*: the forecast profile fitted to the terrain by the mass-consistent solve, once per weather record and blended in time, with the
user's wind edits. It has none of the extras the fire's own 2-D wind adds (night-time decoupling, slope flows, the lee blend, the fire's
indraft), no plume, no temperature and no smoke, and every slice made from it says so. Questions are asked of the view with `airKind`,
`airHas`, `hasAirWind`, `cellHeightAsl` and `airAgeS` (`src/core/airView.ts`), never by reading `nz`: `has3dAtmosphere` now means the
prognostic air only, and a new `hasAirWind` flag means "a wind that can be sliced". The wind speed heat map therefore also works on the
fast tier, from the 10 m wind of the fit.

**Checked against the engines.** The render sampler (`src/render/atmosphereSampler.ts`) does what each engine's own `sample()` does: per
column of the four-column stencil it works out the terrain-following height, finds the level by binary search and interpolates, then blends
the columns. On a real `Atmosphere` and a real `DiagnosticWind` it equals the engine's own value to 1.9e-6 m/s at 1,200 random points from the
ground to 2,000 m on each tier (the test allows 1e-3), and a slice equals the engine's value cell for cell to about 3e-6 m/s on lines across,
along and oblique to a ridge (`src/atmosphere/airView.oracle.test.ts`, `src/render/slice/sliceField.oracle.test.ts`; the numbers are in the
test log). Its allocation-free entry points (`windP` for the wind, `fieldsP` for wind, temperature and smoke) take about 110 and 260 ns and 0.14 bytes per call (a boxing cost of 48 bytes per call that spike S3 found in V8 is avoided).

**What it costs** (measured in node on the build machine, one run each; `[atmos perf]`, `[slice perf]` lines in the test logs): the air
view takes 0.60 ms per snapshot on the fast tier (498 kB, 45 x 45 x 20) and 0.77 ms on the standard tier (815 kB); one slice update
(resolve the line, the four preset checks, sample, the model's cells) takes a median of 0.5 to 1.0 ms and a 95th percentile of up to
1.5 ms, and allocates about 6 kB of result objects and 35 bytes in the reused arrays; one streak step of the 300 particles of 0.5.0 took 0.05 ms (0.6.0 steps 600: a run of `slice.perf.test.ts` gave 0.085 ms and 2.6 bytes a step). These vary from run to
run (in later runs `view()` took 0.40 to 0.60 ms on the fast tier, `windP` 100 to 130 ns, `fieldsP` 182 to 260 ns, a streak step of 300 particles 0.041 to 0.05 ms,
a probe with its sentence 2.9 to 5.5 us and the update's 95th percentile reached 1.59 ms) and they are desktop numbers. Under a 4x CPU throttle in a
desktop browser (still not a phone) the compute alone had a 95th percentile of 7.1 ms on the fast tier and 8.9 ms on the 3-D tier, against the
plan's limit of 8 ms, and the whole update with the panel's redraw and the curtain 18 and 33 ms (plan section 18.3, item 18). A fix round then
moved the panel's repaint out of the update into the next display frame (several slices in one frame are one repaint, and nothing is
drawn while the panel is covered) and cached the axis ticks. Measured again at a 4x throttle in software rendering on the fast tier with
the panel open (150 line edits, three runs): the synchronous update took a median of 4.2 to 4.5 ms and a 95th percentile of 7.9 to 9.5 ms
(it was 10.5 to 11.5 and 17.9 to 20.9), and the repaint, now a frame of its own, a median of 3.3 to 4.4 ms and a 95th percentile of 8.4 to
10.4. The repaint was moved, not removed: update plus repaint is a 95th percentile of about 15 to 17 ms (it was 24 to 26), so the plan's
8 ms is approached and not met for the whole update. The 3-D tier was measured once: 5.9 ms and 12.6 ms (median and 95th percentile of the
update) against 12.7 and 22.3. **Memory:** the fast tier's volume is 12 bytes per cell and level in every picture it publishes (u, v and w;
474.6 KiB at 45 x 45 x 20), and the newest snapshot holds it exactly. The history keeps an older picture's copy packed
(`src/core/airPack.ts`): u, v and w as 16-bit integers with a scale for each, 6 bytes per cell (237.3 KiB), within 0.502 of a step
(`max|f| / 32767`) per field of the exact wind, which is 0.00046 m/s for a 30 m/s field. The packed volumes are in a list of their own
beside the keyframes with 4 % of the room the history has (the embers' share went from 20 % to 16 %; the keyframes keep 72 % and the light
frames 8 %), so a volume never costs a picture. A picture takes the newest saved volume at or before its time and its air time is that
volume's, so the footer's "N min before the time shown" stays true; the live view, the newest snapshot and the 3-D tiers' views are exact.
Measured with real fast-tier Katoomba snapshots over 6 hours at a 60 s step (`npx vitest run src/ui/snapshotStore.fast6h.sim.test.ts
--reporter=verbose --silent=false`), keyframes kept (longest gap in minutes) at the 6 hour instant, at 48, 61.4, 64 and 122.9 MiB: 0.3.0
35 (40), 55 (10), 53 (20), 72 (5); with the volume whole in every keyframe 22 (40), 33 (40), 31 (40), 72 (5); now 39 (20), 57 (10),
55 (10), 72 (5). The count is a sawtooth, so over the last hour the mean is about 5 % lower than 0.3.0's. A keyframe with its volume
weighs about 868 kB on average (0.3.0: 824,636 B, whole volume 1,310,636 B). Thinning only the wind is not counted as thinning the
history. The price is the freshness of the air in old pictures (above). The Data sets memory model (`keyframeBytesModel`,
`keptKeyframeBytesModel`) counts the live and the kept keyframe. The panel, its drawing, the streaks, the probe and its styles are one
lazy chunk that loads the first time the tool opens (gzip size in *Build the phone apps* below); the tool's shell and the scene glue are
in the entry.

**Limits.** The side view's picture was judged on still frames and a real browser in software rendering, not on a phone. It reads the
model's air, and the air is not always the wind the fire feels: the diagnosed wind on the fast tier is the forecast wind where the terrain
bends it, and on a calm night the wind the fire feels can differ a lot from the published 10 m wind that the slice and the wind speed map
show, on both tiers (in the one case measured, a calm-night preset on the fast tier, about 1 cell in 6 had less than half of the
published 10 m wind and about 1 in 5 more than one and a half times it; on a windy day or night the two agree closely; the numbers are
in section 18.4 of the plan). The curtain's ground is the 10 m terrain as received, so a cliff the 3-D view draws steeper is
drawn at its data slope in the curtain. Temp is "warmer or cooler than the average of the slice at that height" (the probe says "than
average"), not a real temperature and not against the whole area; because the average is of the line's own air, on a short line through a
plume the chip understates the plume, which is part of what it is compared with. The layout was measured in software rendering at 390 x 844,
360 x 640 and 844 x 390 (a log of positions, not a phone): at 360 x 640 only the picture and the chips fit in the window of about 230 px,
and a reading of five lines is about 112 px where 80 to 90 px are left under the picture, so it needs a scroll to read in full. Two small
things were left as they are: a tapped candidate on the map beats the crosshair until Cancel (the hint says so), and a preset centred on
the map because there is no fire follows the camera at the rate of the pictures, not at once. That the Tools dial scrolls at 360 x 640 is as
the builders reported and was not re-checked. The time-lapse recorder is 0.4.1 (*Recording a line*, above, with its own limits).

## Wind arrows and flow lines

**What it is** (0.5.0, stage E1 of plan section 9; what was built and what the verifiers found is plan section 20). In *Layers*, under *Wind and air*, the switch **Arrows and flow lines** draws the wind on the map as marks that get more detailed as you zoom in: straight arrows from far away, closer-set arrows, short curved flow lines with arrowheads, and longer flow lines close in. You choose the height of the wind (*Wind height*: What the fire feels, which 0.7.0 added as the first chip and the default, then 10 m, 50 m, 100 m, 300 m, 1 km or 2 km). The same switch, chips and caption are on the Air slices tool's **Map view** tab, and the two are one setting (below). It is **off at first** (decision D9) and the animated *Wind streaks* are a separate control that stays as it was, so either or both can be on. It reads the air and never feeds back: nothing it does reaches the simulation, so the fire is the same with it on or off. Colouring the map by wind speed (E1b) and the 60 m "wind the fire feels" raster (E2) were **not** in 0.5.0 (the owner split E) and are built in 0.7.0: see *The wind the fire feels and Colour the map by speed* below; where this section says there are six chips or that "What the fire feels" is not offered, the later section wins. **0.6.0 changed the most detailed level (L4) and added a chip that names the level**: see *Wind detail and the detailed streaks* below; where this section says L4 is long flow lines, the later section wins. One more correction: 0.5.0 said the layer never animates; at L4 the detailed streaks animate on the GPU (plan 20.3 items 1 and 6, corrected in 21.3).

**The ladder.** The level follows how many screen pixels one cell of the wind model covers at the middle of the screen (`cellPx`, from the camera distance, the field of view and the canvas height), with 15 % of give at every edge (a level goes up at 1.15 times its edge and down at under its lower edge divided by 1.15), so a pinch that hovers on an edge does not flicker:

| Level | One model cell on screen | What is drawn | Lattice (on screen) | Length of a mark (4 px per m/s, clamped) |
|---|---|---|---|---|
| L0 | under 4 px | nothing (the zoom line says "Zoom in to see the wind arrows.") | none | none |
| L1 | 4 to 12 px | straight arrows | 56 px, rounded to a power of two of metres (0.7 to 1.4 times) | 8 to 45 px |
| L2 | 12 to 32 px | straight arrows, closer together | 40 px, rounded (0.7 to 1.4 times) | 8 to 32 px |
| L3 | 32 to 90 px | curved flow lines with arrowheads, 6 to 8 equal steps | at least 36 px (36 to 72 px) | 28 to 56 px |
| L4 | over 90 px | 0.5.0: longer flow lines, 10 steps. **Since 0.6.0: the detailed streaks** (the flow lines remain only when the detailed streaks are not drawn, for example while the first picture is built; the drawing budget no longer takes the streaks away, see *The triangle budget* below); see *Wind detail and the detailed streaks*. **Since 0.7.0** the streaks also ride on the tree tops, part round crowns and ridges and curl into eddies (display only, same section) | 0.5.0: at least 56 px (56 to 112 px), jitter as L3. 0.6.0: about 32 px apart on average at every zoom (a nested lattice, see *Geometry* below), jitter 0.35 | 0.5.0: 90 to 140 px at 6 px per m/s. 0.6.0: 90 to 220 px at 16 px per m/s |

With the 133 m model cell of a 6 km area on a 412 px wide screen the curves begin when about 1.7 km of ground is across the width of the screen and the long lines at about 600 m (the plan's estimate, and 133 / 32 and 133 / 90 metres a pixel across 412 px agree; the real distances follow `cellPx`, and `e2e/wind-glyphs.spec.ts` asserts the level against it, not against distances). A mark's length is constant in screen pixels and saturates (L1 at 11.25 m/s, L2 at 8, L3 at 14, L4 at 23.3), so above that the **colour** carries the speed: the colours of the Wind streaks near the ground (`WIND_RAMP`, pale grey-blue at 0 m/s, near white at 4, pale cyan at 8, blue at 12 and 17, violet at 25: 0 to 90 km/h on the legend card). They are not the Wind speed map's cool-to-warm colours (0 to 60 km/h and over): the 10 m chip shares that map's *field*, not its colours, and since 0.7.0 *Colour the map by speed* paints that map in its own colours under the arrows' unchanged ones. Every stroke is 2.5 px of colour on a dark navy halo (5 px in all), so the pale stops stay readable on the aerial photo, plain relief and the night looks; the colour of a segment is the wind speed at its start.

**How a picture is made** (`src/render/wind`, no DOM and no Three.js in the engine, node-tested):

- *Seeds* sit on a world-anchored lattice (a power-of-two spacing in metres; at L3 and L4 each seed is moved inside its cell by an integer hash of its indices, never `Math.random`), so sliding the map never reshuffles them and zooming changes the spacing in steps. Only seeds whose exact projection is on the screen (plus the length of a mark) and in front of the near plane are kept. The lattice spacing of the curved levels is the next power of two that is **not denser** than the level's spacing, and the straight levels' the nearest, with 0.06 octave of give past an edge, so the same zoom gives the same lattice from either direction (a verifier found 200 glyphs when pinching in and 819, a mat, when pinching out before this rule). In an orbit view a seed is also kept with probability 1 / s2, where s2 is the ground area one pixel covers there against the middle of the screen (at most 64), so the number of marks per screen area stays about constant toward the horizon; over a top view of flat ground s2 is 1 everywhere.
- *Tracing*: from a seed the mark runs downwind in equal steps (RK2, the midpoint rule, on the unit direction field, so the arc length is constant and the length is exactly the pixel length asked for). L1 and L2 are one chord; L3 and L4 are 6 to 10 steps through the same field, so a curve is only as curved as the model's field is: **a model cell is 100 to 270 m wide, so the curves are a smooth fit through it and show no detail finer than that** (the caption says so once a cell covers more than about 60 px). A wind under 0.3 m/s is a 3 px dot, and a trace that falls under it stops. The head is two chevron segments at 28 degrees to the way back, 0.35 of the length clamped to 5 to 9 px. A mark stops at the edge of the model's domain, and a mark with any point behind 1.5 near-plane distances is dropped whole.
- *The cliff rule*: a mark is draped on the drawn ground, so a flow line that met an escarpment ran down its face as an upright streak that reads as an updraft. No step may now climb or fall more than 1 m per metre along the ground (45 degrees of true slope, whatever the vertical exaggeration): a mark is cut at the foot or the lip of a wall with its head there, one that starts on a wall is not drawn, and a head over a wall drops its mark. Before this rule 3.4 to 6.8 % of the segments (8 to 21 % of the marks) at three Katoomba escarpment views were upright; after it 0.0 % in 12 cliff views. In node 8 % of the marks are cut or dropped over 16 L3 pictures (Katoomba is cliff-heavy).
- *Drawn through the trees*: the strokes lie 1.5 m (or 3 px) above the ground, under the drawn canopy, so a crown in front of a stroke would hide half of every flow line close in. The streak shader takes a depth bias (`uDepthBias`, 40 m toward the eye along each end's own ray, for the depth test only, so a stroke stays where it is on the screen), which shows a stroke through a crown of up to about 25 m, while a ridge still hides what is behind it (switching the depth test off showed every line behind every ridge). Halo pixels at 700 m and 55 degrees: 6,645 without the bias and 16,243 with it (a verifier's count).
- *Eye level draws nothing* (the target is one metre away, so "model cells a pixel" means nothing there; the control says "Not drawn at eye level. Go back to the map view."). The 2-D demo map (`?mock=1`) has no air and draws no glyphs.

**Height, and where the numbers come from.** *What the fire feels* (the key `'felt'`, 0.7.0) reads the snapshot's own 60 m raster, `SimSnapshot.fireWind`, in place of the air view (see *The wind the fire feels and Colour the map by speed*). *10 m* (the key `'fire'`) is `surfaceU/V` as the air view publishes it, used as it is with no copy and no refinement: the model's wind about 10 m above open ground, as the model fits it to the terrain, the field the Wind speed map shows, on both tiers. It is **not** the wind the fire feels: on a calm night the fire can feel much less wind in places and much more in others (plan 18.4 measured, on the fast tier, p10 0.34 and p90 2.2 of the published wind), and the caption says so. There is no chip between 10 m and 50 m, because the model's lowest level is about 15 m above the ground (`dz1 / 2`; 12.5 m on the High tier). The other chips are metres above the 10 m ground **as received**: a raster of (u, v) is filled once for each snapshot and height, a texel being `windP` of the sampler at (x, y, ground + h), at the model's own column spacing and at half of it where a cell covers more than 60 px (refined: up to 119 x 119 texels on the High tier, 89 x 89 on the others), by rows on the clock, never for a camera move; the marks are traced through it, and a rebuild reads rasters only. The ground is the 10 m terrain as received (plan section 4, rule 10) and the marks are drawn on the render mesh, so the Map view and the Air slices' side view agree at the same height (the same `zAsl = ground + h` rule). Measured by a verifier: the render mesh and the 10 m ground differ 0.8 m on average (the verifier also reported 14 m and a 95th percentile of 36 m on slopes over 45 degrees); the wind read at the two grounds differs 0.1 % overall and 2 % on average (7 % at the 95th percentile) on steep slopes at 50 to 100 m; the 1.5 m lift buries 0.03 % of the samples. Against tracing straight through the sampler (the test oracle, `glyphOracle.testing.ts`), on real Katoomba air the end points of the raster's marks differ by a mean of 0.064 to 0.139 px at 1x (95th percentile 0.27 to 0.51 px) and 0.02 to 0.05 px at 2x, at most 0.2 % of the marks over 3 px; through the real sampler a uniform wind deviates 8e-5 m, a solid-body rotation recovers its radius within 2e-7 and a saddle within 6e-6, and the steps of a mark are equal to 1.5e-5 (verifier measurements; the builders' synthetic field had said 0.45 to 0.56 px). The direction was checked against the independent snapshot wind on the preset *hot-nw-sw-change* (the mean surface wind blows to the south-east): the first segment of every mark has a cosine of 1.000 with it at the 10 m wind and at 300 m, in top, orbit and orbit-east views, on both tiers, and the animated streaks agree (cosine 0.99998).

**The words** (`src/ui/screens/sim/glyphWords.ts`, pure, node-tested; pinned to Help by `content.test.ts`). The caption under the chips says which wind is drawn, how fine the model grid is and when the air is from, parts joined by " · " and ending in a full stop: "Wind at 100 m above the ground · model grid 133 m · air from 14:05." For the 10 m chip: "Wind about 10 m above open ground · model grid 133 m · air from 14:05." and, on the fast tier only, "Wind about 10 m above open ground, as the model fits it to the terrain · ...". "air from" is the footer's own phrase (a pinned test holds the two equal: "wind from" read as a compass direction), with "(4 min before the time shown)" past 90 seconds, and "air time not recorded" when there is none. Further lines: "Diagnosed wind: terrain effects only, no plume." on the fast tier; for the 10 m chip "On a calm night the fire can feel much less wind than this in places, and much more in others." (0.7.0: with " Choose What the fire feels to see it." added when the picture has that wind); for What the fire feels the lines of the next section; above 60 px a cell (of the data drawn: 60 m for What the fire feels) "At this zoom the curves are a smooth fit through the model, not new detail." Under the caption a zoom line says what is drawn ("Showing straight arrows. Zoom in for more.", "Showing straight arrows, closer together. Zoom in for flow lines.", "Showing curved flow lines.", "Showing long flow lines.") or why nothing is ("Not drawn at eye level. Go back to the map view.", "Waiting for the wind picture.", "Not drawn here: this view already uses all the phone can draw. Zoom out or switch a layer off."). The legend card (`windGlyphLegend`, "Wind near the ground" or "Wind at 100 m", in km/h) follows the switch, with the precedence heat map, coded trees, Air slice, then the arrows, then the streaks, and is hidden at eye level; it is still shown at level 0.

**The controls** (`windGlyphControls.ts`, one builder for both places). In Layers, Wind and air, one switch row "Arrows and flow lines" sits after the Wind streaks control and before Air slice; once it is on, the seven Wind height chips (What the fire feels first, on a row of its own and allowed to wrap its words at a large text size; the six others three to a row, fewer at a large text size), the *Colour the map by speed* chip, the caption and the zoom line appear (built the first time it is on, in the panel's DOM, and hidden when it goes off: the Layers panel's DOM was 940 nodes open without the row, 955 with the row off and 991 with it on, 1,118 with the air slice's box, a heat map and the coded trees also shown, so the headroom under 1,000 is 9 nodes and any next row must build lazily; these are the `layers.spec.ts` annotation, not repeated by the docs lane. **0.7.0:** the seven chips and the map chip take the panel with the row on to **999 of the 1,000 nodes** (the release run's figure, as reported to the docs lane and not re-measured by it; `e2e/layers.spec.ts` asserts at most 1,000 and logs the number). The map chip is the button itself, one node, aligned left by one CSS rule: a first version with a wrapper and a line of its own for its reason counted 1,001 and failed the assertion, so its reason became a caption line under the chips, which is also its accessible description). The Air slices tool's Map view holds the same switch (named "Wind arrows and flow lines" there, with one line while it is off: "Draws the wind on the map: arrows from far away, flow lines when you zoom in."), chips, caption and zoom line: both read and write the layer store, the scene and the remembered choice, so a change in one is there when the other is shown. The caption follows the layer's own statistics (`view.windGlyphStats()`), read twice a second only while the control is on screen and the switch is on, and text is rewritten only when it changed. On the 2-D map the switch is disabled with "Needs the 3-D view" and its chips are hidden (a remembered "on" can still be turned off); before the first picture of the air it says "Needs the air picture, which the simulation makes once it has started". Two additive remembered keys, `windGlyphs` and `windHeight` (the layer prefs version stays 1; a height that is not one of the seven, such as 10, 150 or the chip's text "300", is dropped and the default stays, a saved "10 m" is kept and only a new profile starts on What the fire feels, and Reset puts both back). The debug statistics' Display group has a row **Wind glyphs**: "Off", why nothing is drawn, or for example "Level 3, 412 glyphs, 2,980 segments, rebuild 3.1 ms (p95 slice 4.2 ms, max 6.0 ms)" with "One model cell is 133 m, about 45 px on screen; 14 rebuilds so far, the last in 2 slices" as its note (the example of `debugStats.test.ts`), "Level 0, nothing drawn at this zoom", "On, not drawn at eye level", "On, waiting for the wind picture", "On, not drawn: the view already uses all the triangles a frame may have", and "Not available (this view draws no wind glyphs)" on the 2-D map; it is in the copy as text. The dev page (`src/render/dev.html`, never built into the app) takes `?arrows=1&wh=felt|fire|50|100|300|1000|2000` (any other `wh` stops the page with a message; the page has no `fireWind`, so `felt` draws the 10 m wind there).

**Cost and budgets.**

| Item | Figure | Where it comes from |
|---|---|---|
| Draw calls | +2 while marks are drawn (a halo batch and a colour batch of `StreakBatch`, `renderOrder` 5 and 6) | `wind-glyphs.spec.ts` counts them; the plan's limit of 25 was already exceeded by the 0.4.1 layers with everything on (16 to 29), the layer makes it 18 to 31 |
| Triangles | 4 a segment, for both batches; caps per picture tier of 600 / 1,200 / 2,000 glyphs and 4,000 / 8,000 / 12,000 segments (at most 12 a glyph); the layer trims itself from `renderer.info` against 550,000 triangles (**0.6.0: for the arrows and flow lines only; the detailed streaks keep a floor over it, see *The triangle budget* below**) | the plan's 48k assumed one batch: it is 96k at the High cap. Verified by a verifier: the largest High frame with everything on 546,580, Medium 380.9k, Low 243.9k, and at a faked 546k, 549k and 552k the trim left room for 1,000, 250 and 0 segments, with no flapping |
| Rebuilds | at most four a second (250 ms from the last swap; the first picture and a settled frame are never held), staged: the raster fill in clocked slices of its own, then the trace, each slice at most 8 ms, the batches change only at the swap; a rebuild is 1 to 3 slices | at a 4x CPU slowdown in software rendering a slice's 95th percentile was 8.1 to 8.5 ms (maximum up to 13 ms on a loaded machine); the numeric height's raster fill alone had been one slice of 14.0 ms |
| Frame loop | levels 1 to 3 never switch `animating` on: a still map stays still (no frame in 3 s with the glyphs on, an idle tick of 0.04 bytes); level 4 animates on the GPU (0.6.0), and since 0.7.0 nothing animates after a minute without activity (the idle stop, below) | v-render; the later sections for 0.6.0 and 0.7.0 |
| Memory | typed arrays of the High tier: the builder's output 560,196 bytes and the two batches' own copies 960,000 bytes (1.45 MiB), and 226,576 bytes for the raster of a numeric height, made the first time one is used; the same 0.96 MB on the graphics side | derived from the allocations in the code (equal to the verifier's 1.45 MiB); the layer is not built lazily (it would save under 2 % of the ArrayBuffer memory) |
| Engine cost (node) | a docs-lane run (`npx vitest run src/render/wind/flowGlyphs.perf.test.ts src/render/wind/flowGlyphs.alloc.test.ts`, one run, a desktop core): a rebuild of 1,864 glyphs and 11,082 segments (L3 at its densest, near the High cap) a median of 1.52 ms (p95 2.11 ms), in slices of 3.4 ms a slice p95 of 1.70 ms and a maximum of 2.29 ms; the raster of a numeric height on 45 x 45 columns 0.26 ms at the model's spacing and 1.00 ms at half of it; a builder's first (cold) picture 14.0 ms in 4 slices; an orbit view over a 32 m lattice (about 132,000 cells in its box) 11.2 ms in 4 slices; 93 to 413 bytes allocated a rebuild with inlining off (L1 93, L2 157, L3 413, L4 221, calm dots 381); heap +27.4 kB over 3,000 rebuilds. The lanes' and verifiers' runs on a loaded machine: a median of 1.2 to 1.45 ms, a slice p95 of 1.2 to 2.9 ms, a cold rebuild 25 to 65 ms over 9 to 10 slices | the tests allow 1 kB a rebuild and 100 kB of heap; `flowGlyphs.perf.test.ts` has a wall-clock test that failed once under load (it passes alone) |
| First switch-on | no work by itself; the first picture comes about two frames later, a synchronous cost of 0.1 to 1.2 ms at 4x | the design's warm-up rebuild was measured to buy nothing and dropped |
| Leak | geometries 14 and textures 17 unchanged after 60 toggles and 20 zooms; 5 *New scenario* cycles clean | v-render |
| Bundle | the engine, the layer and `streaks.ts` are in the lazy render chunk; the entry holds the words, the controls and `glyphTypes.ts` | see *Build the phone apps* |

When the rest of the frame already uses every triangle a frame may have, the layer trims itself to nothing and says so (the `'budget'` state, above); it looks again by itself once a tenth of the tier's cap fits. **Since 0.6.0 this holds for the arrows and flow lines (levels 1 to 3) only**: the detailed streaks of level 4 are never trimmed to the frame (*The triangle budget*, below).

**The Map view tab and Turn off the slice** are described under *Air slices and the air picture* (*The two tabs*, *Turn off the slice*).

**Pictures.** 37 (curved flow lines at a zoom where one model cell is about 50 px, top view, the 10 m chip), 37b (straight arrows, the whole 6 km area across the screen), 38 (close in over the forest, one cell about 150 px, trees and the aerial photo on: the strokes show through the crowns) and 39 (the Layers row with its chips and caption) are in the table at the top; 40 and 41 are under *Air slices and the air picture*.

**Limits.** Seen only in software rendering and in node, never on a phone: the ladder's edges while pinching, the halo's legibility in sunlight and on the aerial photo, 2.5 px strokes at a pixel ratio of 3, rebuild hitching while panning, the battery, TalkBack. In an orbit view at a tilt of 68 to 82 degrees the L3 rows stack about 10 to 13 px apart near the horizon and convergent flow makes bundles (thinning by the nominal pixel area would also thin the default tilt-55 view by about 0.57 at the centre, and cannot be tuned without a phone; not fixed). L1 and L2 marks are one chord, so over relief 6 to 17 % are partly under the ground (2 to 5 % of their length). Pan invariance is bit-exact only for an overhead camera over flat ground (over relief a mark's length in metres changes by 2 to 15 %, constant in pixels). The far zoom shows few marks (26 to 30 at 12 to 18 km). A model cell is 100 to 270 m, so there is no detail finer than that, and the animated streaks and the marks can clutter when both are on. See plan 20.4.

## The wind the fire feels and Colour the map by speed

**What it is** (0.7.0, items A and B of the owner's follow-up list: E1b and E2 of plan section 9, built together; plan section 22). *What the fire feels* is a seventh Wind height, the first chip and the one the app starts with: the wind that the fire model itself is given at each cell, in cells of about 60 m, in place of the air model's wind at a height. *Colour the map by speed* is a chip that paints the Wind speed map at whichever Wind height the arrows are drawn at. Both are display only: the picture is read after the engine made it, and nothing in them reaches the simulation. The one change on the engine's side is that every snapshot carries one more picture (below), a pure read of arrays the engine already had.

**The data** (`src/core/fireWind.ts`, pure and in the entry chunk; `src/sim/fireWindPublish.ts`, the publisher, in the engine). The fire grid's wind `env.windU/V` (m/s east and north: what the spread model is given at each cell, spec section 12.2 step 4, which the 3-D tiers refresh at every air step and the fast tier once a minute, `SIM_PARAMS.fastWindIntervalS` = 60, and whenever a stamp, a wind edit, an option, the tier or a restore changes its inputs) is **averaged in blocks** to about 60 m (`fireWindBlock(cellSize)` = `max(1, round(60 / cellSize))` fire cells to a side: 3 at 20 m, 2 at 30 m, so 60 m at both of the grids the app builds; an edge block averages the cells it has) and **quantised to Int16 at 0.01 m/s** (`round(mean x 100)`, clamped to +-32,767, a mean that is not a number stored as 0; the error of a stored value is at most half a quantum, 0.005 m/s). Block mean and not every second cell, because a 60 m cell "feels" the mean and a point sample would alias the ridge and lee cells. The result is `SimSnapshot.fireWind`, a `FireWindRaster` (`grid` of the block centres, `u`, `v` as `Int16Array`, `block`, `time`), **a field of its own** and not in `layers` (which the overlay code reads as `Float32Array`s). The sums run in double precision, row by row in a fixed order, so the same inputs give the same bytes on every machine, and `snapshotHash` (which hashes every field but `engine`) differs from 0.6.0's only by this field (`src/sim/fireWind.identity.sim.test.ts`: a run with the publisher off has every other part of every snapshot bit-identical, on both tiers and on Katoomba, with a rewind).

| Area | Fire grid | Block | Picture | Bytes a picture (two `Int16Array`s and 64) |
|---|---|---|---|---|
| 3 km, 30 m | 100 x 100 | 2 | 50 x 50 | 10,064 |
| 6 km, 30 m | 200 x 200 | 2 | 100 x 100 | 40,064 |
| 6 km, 20 m | 300 x 300 | 3 | 100 x 100 | 40,064 |
| 12 km, 30 m | 400 x 400 | 2 | 200 x 200 | 160,064 |

The bytes are `fireWindBytesModel(nx, ny, cellSize)`, which the memory model adds to a keyframe (`keyframeBytesModel(..., fireWindBytes)`, and `workingMemory` takes the fire cell size for it). The picture goes in the **newest snapshot** and in **every keyframe** of the history (`ui/snapshotStore.ts`: a keyframe every 300 s, or the display step if larger), `keyframeBytes` counts it, and truncation and thinning drop it with its keyframe. `compose()` returns the keyframe's own picture (`key ? key.fireWind : head?.fireWind`), so a picture you jump back to shows the wind of the nearest saved moment at or before it, **up to one keyframe interval older**, stamped with its own `time` ("air from 14:05"). A kept keyframe is exactly 40,064 B heavier at 6 km, 4.6 % of the keyframe a thinned store keeps; `src/ui/snapshotStore.fast6h.sim.test.ts` (now a sweep over 16 history budgets from 44 to 70 MiB, no longer gated by `FIRESIM_SKIP_SLOW`) pins that the total never exceeds the budget and that the 3 h mean of kept keyframes is at least 0.85 of the run without the picture (worst measured 0.868 at 59.5 MiB, mean over the sixteen 0.952: the count of kept keyframes is a sawtooth of the budget, 33 to 58 within one hour, so the first version of the test, one hour at four budgets, held at those four only). The host lists both buffers in `snapshotTransferables` (`+0.01 to 0.16 MB` a message, transferred, intact in the in-thread engine; `host.fireWind.test.ts`). **The demo engine has no air and publishes none**: nothing is faked, and *What the fire feels* then draws the 10 m wind and says so. The scout's node timings of the publisher (block mean and quantise, a shared machine, upper bounds): 0.08 ms at 3 km, 0.39 ms at 6 km and 30 m, 0.49 ms at 6 km and 20 m, 1.66 ms at 12 km, about 2.35 times that on a phone by the plan's own estimate (6.2): not measured on a phone, and the fallback is point sampling (about 0.4 ms at 12 km).

**What a person sees** (`glyphWords.ts`, `windMapWords.ts`, `windDetailWords.ts`; pinned to Help by `content.test.ts`).

- *The chip and the default.* `WIND_HEIGHTS` is `['felt', 'fire', 50, 100, 300, 1000, 2000]`; `DEFAULT_LAYERS.windHeight` is `'felt'` (`'fire'` stays the 10 m wind, so a saved choice and the 10 m picture survive: only a new profile starts on the new chip). The label is long, so its chip has a row to itself and may wrap its words at a large text size (`layers.css`). The wind glyph layer decodes `fireWind` into one of **two alternating Float32 stores** made on first use (80 kB each at 6 km, 320 kB at 12 km: the builder reads one while the next picture fills the other), so the tracer reads a `FlowRaster` as always and nothing in `flowGlyphs.ts` or `detailStreaks.ts` changed for it. The zoom ladder keeps its key, one cell of the *air* model on the screen, so the levels and the Wind detail pips do not move with the chip; the smooth-fit sentence of 60 px follows the cell of the data that is drawn.
- *The caption* for the chip: "Wind the fire feels · 60 m cells · air from 14:05." (the cell is the picture's own; the time is `fireWind.time`), then "The wind the fire model uses in each 60 m cell: slope flow, lee eddies and the fire's own effect on the wind are included. It is not a measurement.", on the fast tier "On the fast model it is refitted once a minute." (after "Diagnosed wind: terrain effects only, no plume."), and "On a calm night much of it is air draining downhill." The 10 m chip's calm-night sentence ("On a calm night the fire can feel much less wind than this in places, and much more in others.") gains "Choose What the fire feels to see it." when the picture has the fire's wind. A picture without it (a recording from before 0.7.0) draws the 10 m wind and says "The wind the fire feels is not in this picture, so the 10 m wind is shown." The words say *the fire's own effect on the wind* and not "the fire's own draw": on the fast tier 99.6 % of the cells that the fire changed point toward the fire, but on the 3-D tier at 25 minutes only 4 % do, because it is the plume's own flow and not a radial indraft (the measurement of the lane that changed the words, message of `0dee4d7`, plan 22.3).
- *The calm-night sentence is checked.* On `calm-night-katabatic` (the Katoomba demo at 03:00) on the fast tier 82 % of steep ground drains downslope in the fire's wind, where the 10 m open-ground wind does not (the lane's measurement, in the message of `7051f64`; the comment on the sentence in `glyphWords.ts` says it was checked on both tiers, and the sentence says "much of it", not a share).
- *The sheet* says "The wind the fire feels, in cells about 60 m wide." as the picture's name, and at the closest zoom "Direction and speed come from the air model, with the fire model's slope flow and the fire's own effect on the wind added, in cells about 60 m wide." and the bends line (below).

**Colour the map by speed** (`windMapSwitch.ts`, the chip; `windMapWords.ts`, the rules and words; `render/wind/windMapField.ts`, the values; `render/layers.ts` `windMapHeight`).

- *No new heat map.* A new `OverlayKind` would have needed a catalog row, and a heat row is about 15 DOM nodes against the Layers panel's headroom of 9. So the existing **Wind speed** heat map follows the Wind height **while Arrows and flow lines is on** (`windMapHeight(layers)` is `windGlyphs ? windHeight : 'fire'`), and with the arrows off it is the 10 m map exactly as before. The chip, a filter chip under the Wind height chips (`data-testid="wind-map-chip"`, built lazily with them), is pressed exactly while `overlay` is `'windSpeed'` and writes that one key (`windMapPatch`: `windSpeed` or none), so it and the Wind speed row are one state, one heat map shows at a time, and the solo-heat rule is the same. It stays visible and operable while the map is on, so it can always be turned off.
- *It needs what the row needs: a fire marked* (an ignition, or ground already burnt, as the Layers panel works it out). Until then it is greyed and the caption says why: "Colour the map by speed. Needs a fire: mark one first." (also its `aria-describedby`). While it is on the caption adds "The ground is coloured by wind speed at this height; the legend shows the colours." The Wind speed row's second line says which wind it is once the map follows another height ("In km/h, the wind the fire feels", "..., at 100 m"), and its catalog text now says "or at the height you chose for the arrows".
- *The values* (`windMapField`, pure; km/h = |(u, v)| x 3.6, `NO_DATA` where a texel is not finite): the 10 m height is `surfaceRaster` (the model's `surfaceU/V`), What the fire feels reads the Int16 picture directly on its own 60 m grid, and a numeric height fills a `HeightRaster` at the model's own spacing (refine 1, run to the end, made on first use) over the 10 m ground as received, the same raster the arrows trace. A picture with no `fireWind` makes the 10 m map for What the fire feels. A numeric height for a picture with **no 3-D wind** (a scrubbed frame whose volume the history thinned away) draws **no data** and not the 10 m field under the height's title (a verifier's finding; `overlayField` returns no field for a numeric height without a map), and the legend says "No wind data at 300 m in this picture" in its no-data entry, as the other heat maps do. `SceneViewApi.overlayStats()` (additive) returns the overlay, its source (`surface`, `height`, `felt` or `other`), the raster's size and cell and its range in km/h, for the e2e and the verifier.
- *The legend.* One ramp (`amountRamp`), two ranges: **0 to 60 km/h** for 10 m, What the fire feels, 50 m and 100 m, **0 to 90 km/h** from 300 m (`windSpeedRangeKmh`; the arrows' card also ends at 90 km/h, and the colours are by fraction, so a cached LUT is stretched through `hi`). Titles: "Wind speed near the ground" (10 m, unchanged, with the Beaufort words), "Wind speed the fire feels" and "Wind speed at 100 m"; the note says which wind and, for What the fire feels, that its cells are about 60 m. The arrows **keep their own colours** on top of the map (the legend card is the map's, by the existing precedence), as the Wind streaks do over any heat map.
- *Cost.* No draw call and no triangle: the map is the one overlay texture (R32F, refilled at equal size, 160 kB at 12 km for the 200 x 200 picture) and a LUT; per snapshot one field is made synchronously in `update` (a `HeightRaster` fill costs 0.3 to 0.5 ms by the plan's estimate, not re-measured).

**Limits.** Near a fire the field converges on the fire: true to what drives the fire, and said so. On the fast tier a picture is up to a minute old. A jumped-back picture shows a keyframe's wind, up to 5 minutes older, stamped. The look of the 60 m picture on the 3-D tiers and on the High picture tier, and the cost of the publisher on a phone, were not seen or measured. The Wind detail chip stays while the map is on (the arrows are on then); it is hidden only for the Wind speed map on its own. `e2e/wind-map.spec.ts` and `e2e/wind-felt.spec.ts` check the chip, the map at a height, the legend and the numbers, the history keeping the picture and the words, in the real app (`e2e/fireWindFixture.ts` gives the snapshot shown a stand-in 60 m picture only where the engine's own is missing, and each test says which it used).

## Wind detail and the detailed streaks

**What it is** (0.6.0, requests 1 and 2 of the owner; plan section 21). Two connected changes to how the wind is drawn. The **Wind detail chip** says how detailed the wind on the map is at this zoom, and says why it is not more detailed. The **detailed streaks** are what the most detailed level (level 4, a model cell wider than about 90 px on the screen) now draws, in place of 0.5.0's long flow lines. Both are display only: nothing in them reaches the simulation, so the fire is the same with them on or off. **0.7.0 changed the detailed streaks again** (they ride on the tree tops, part round tree crowns and ridges and curl into eddies, *The relief* below), added an **idle stop** and made the older Wind streaks and the trees obey reduced motion; where this section describes the 0.6.0 look or says the streaks cross the crowns or that the older streaks ignore reduced motion, the 0.7.0 bullets win.

**The chip** (`src/ui/screens/sim/windDetailChip.ts`, `windDetailState.ts`, `windDetailWords.ts`, `windDetailSheet.ts`, `windDetailPips.ts`; `.wind-detail` and `.wd-*` in `sim.css`). A `chip chip-float` button of at least 44 px, "Wind detail" and four pips: a filled circle for each step reached and a ring for the rest, so the shape carries the step and not the colour. It stands in the bottom-left stack of the map, directly above the legend card (above the attribution line when the legend is hidden), `simScreen.ts` sets its place with the legend's. It steps aside for what the legend steps aside for: an open Layers or other panel, a full sheet and drawing a line hide it (`display: none`), and an open menu hides it without moving anything. It is shown only while a wind layer is on (the Wind streaks, either kind, or the arrows and flow lines), in the 3-D view, once the air is there; it is **not** shown for the Wind speed map on its own (a coloured heat map, not marks; with *Colour the map by speed* on the arrows are on too, so the chip stays), in the 2-D map (no statistics), at eye level unless the Wind streaks are on, or while it would only say "waiting for the air". A tap opens its sheet, a bottom sheet of the top bar's popovers (the pattern of the slow-run sheet: Escape, an outside tap and Back close it, focus returns to the chip, two columns on a short landscape screen). Nothing opens or speaks by itself: no live region, no toast, no alert.

| Step (pips) | What is drawn | Sheet's first line |
|---|---|---|
| 0 | nothing: a model cell is under 4 px, or the view already uses all the phone can draw (the arrows and flow lines only: the detailed streaks are never trimmed to nothing, see *The triangle budget*) | "Nothing is drawn at this zoom." |
| 1 | straight arrows; or the Wind streaks moving over the whole area; or the Wind streaks through the air | "Level 1 of 4: straight arrows." / "moving streaks over the whole area." / "moving streaks through the air." |
| 2 | straight arrows, closer together | "Level 2 of 4: straight arrows, closer together." |
| 3 | curved flow lines (also the long flow lines of 0.5.0 when the detailed streaks are not drawn) | "Level 3 of 4: curved flow lines." |
| 4 | the detailed streaks | "Level 4 of 4: detailed streaks." then "This is the most detailed level." |

The level is the **finest wind picture actually drawn**, read from the layer's own statistics (`view.windGlyphStats()`), so the chip and the picture cannot disagree. What holds the picture back is a list, in the order the sheet says it: *the zoom* ("Zoom in for more detail."; the Wind streaks over the whole area add "These streaks do not get more detailed as you zoom in, until the closest level."), *the model's cells* ("The air model works on cells about 133 m wide. Between its points the wind is a smooth fit."; at level 4 "Direction and speed come from the air model, which works on cells about 133 m wide." and, since 0.7.0, "Where the ground rises or trees stand, the streaks bend around them, and small eddies are added behind them. These bends and eddies are added for looks, from the shape of the ground and the trees. The streaks also move faster than the real wind so that you can see them."; at the What the fire feels height the model line is "Direction and speed come from the air model, with the fire model's slope flow and the fire's own effect on the wind added, in cells about 60 m wide."), *the drawing budget* ("Not drawn here: this view already uses all the phone can draw. Zoom out or switch a layer off."; since 0.6.0 only for the arrows and flow lines, because the detailed streaks keep their floor in a full frame), *the tier* ("The fast tier's wind is estimated from the forecast and the shape of the ground. It is not simulated." on the fast tier's diagnosed wind; the standard tier's 3-D air says nothing here), *reduced motion* ("Your phone is set to reduce motion, so the streaks stand still."; since 0.7.0 it also applies at every zoom while a Wind streaks switch is on, because the older streaks stand still too) and, new in 0.7.0, *the pause* ("The streaks paused to save battery. Touch the screen to move them again."). The sheet also says which wind it is, at the layer's **Wind height** ("Wind about 10 m above open ground.", "Wind at about 100 m above the ground." or "The wind the fire feels, in cells about 60 m wide."). Eye level and "both wind layers off" do not appear in the sheet because they hide the chip.

Cost: the state is polled **every 250 ms**, only while a wind layer is on, the screen is in view (`IntersectionObserver`) and the page is not hidden, and again at once when a layer switch, the camera mode, the Wind height or the air changes; the DOM is touched only when the state's key changes, so a still map costs one object read and one string compare four times a second. The state module, the pips and the chip are in the entry chunk; the sheet and its words are a **lazy chunk of about 1.27 kB gzip** loaded on the first tap (the integration lane's figure). The open sheet repaints itself on the same 250 ms.

**The detailed streaks** (`src/render/wind/detailStreaks.ts`, the pure builder; `detailBatch.ts`, the batch and its shader; `windGlyphLayer.ts` owns both). At level 4 both switches feed **one** picture: the arrows and flow lines, and the Wind streaks when they are the near-ground ones (`wind: 'surface'`; the through-the-plume streaks are untouched). The layer asks `planLod(..., detail = true)` for the last level, which then takes the numbers of `DETAIL_GEOMETRY` (`glyphTypes.ts`) instead of 0.5.0's flow lines (without the flag every 0.5.0 number and test stands), builds the lines with `createDetailBuilder(tier)`, hands the builder the Wind height in metres (`heightM`, 10 for the 10 m chip) and the 10 m ground, and draws them in one `DetailBatch`. The old Wind particles step aside (`WindLayer.setSuppressed`) only while the detailed streaks are actually drawn, so a picture trimmed to nothing gives them back.

- *Look.* Each streak is a comet: a bright, thick head and a tail that thins to 45 % of the width and fades (`TAIL_WIDTH`), born at a random phase with its own life and a dead gap of 0 to 60 % before the next pulse, so streaks come and go. A pulse crosses its line at about 14 px per m/s of the line's wind, clamped to 40 to 260 px a second, and a cycle lasts 70 to 130 % of the time that takes (that is a speed on the screen, **not** the real wind's: the sheet says the streaks move faster than the real wind so that you can see them). The tail is `6 px per m/s + 20`, clamped to 24 to 90 px. Brightness swells and dims between 0.85 and 1.15 along a wave of about 120 m that travels with the line, and a windward slope is up to 12 % brighter and a lee up to 12 % dimmer. The colour is the model's speed, the **same ramp as the arrows and flow lines** (`WIND_RAMP`, baked by the glyph builder's speed table), and nothing in the shader changes a colour. The stroke is 3.2 px of colour on a dark navy ring (0.4 of the width each side, 60 % opaque), so the pale stops read on every ground; `DETAIL_WIDTH_PX` and the rest are first guesses to be tuned on a phone.
- *What is the model's, what is added.* Direction and speed along a line, and the colour, come from the air model's wind raster (the builder traces through the same raster as 0.5.0's glyphs, at the layer's Wind height). The **eddies are not the model's**: a time-varying meander shifts every vertex sideways, in three octaves of value noise (wavelengths 60, 15 and 4 m, 40, 10 and 2.4 m peak to peak, so up to about 20, 5 and 1.2 m either way), and an octave counts only as far as it would show (its weight rises from 0 at 0.75 px of amplitude to 1 at 3 px), so more eddies appear the closer you zoom; the meander's strength is between a quarter and all of `turb`, which the builder takes from the 10 m ground as received (`0.25 + 0.5 (roughness + lee) x the height factor`: the roughness is the spread of a 5 x 5 patch of 10 m steps about its best plane, a plain slope is not rough, and the **lee** is a fall along the flow measured against a slope of 0.35), and a line is drawn up to 3 m higher over a windward slope and sinks the same in a lee, never nearer the ground than 0.5 m (`lift`). All of that fades with the Wind height as `exp(-(h - 10) / 300)` above 10 m: 1 at 10 m, 0.38 at 300 m, 0.04 at 1 km, so a 300 m wind is hardly bent by the ground below. The model does not compute eddies, and the chip's sheet says so in plain words.
- *Geometry* (`DETAIL_GEOMETRY`): lines **about 32 px apart on average at every zoom** (`spacingPx` 32: one line to about 32 x 32 px; about 460 to 860 lines at 412 x 915), jitter 0.35, a line 16 px per m/s long clamped to 90 to 220 px, traced in steps of 9 px by RK2 (8 to 24 segments), a calm seed (under 0.3 m/s) draws nothing, the cliff rule and the near-plane rule of 0.5.0 apply, a line of under three segments is not drawn. Caps by picture tier: 4,000 / 8,000 / 12,000 segments (Low, Medium, High), thinned by a hash over the whole screen (so the thinning does not follow the order of the lattice); a build that fills the High cap keeps 95 % of it, about 11,400 segments. The 40 px lattice of the first build (one power of two of metres, so 40 to 80 px apart) and its 32 px successor (32 to 64 px) lost three quarters of their lines through each octave of zoom and got them back, with the whole picture replaced, at the edge: a verifier saw the density jump fourfold there.
- *The nested lattice* (0.6.0, `detailStreaks.ts`, `planLod`). The lattice is **nested and dyadic**: the world points of a finest lattice of 2^j metres and of every coarser one (twice, four times, ... the spacing), each a subset of the finer. A point's identity is the coarsest lattice that holds it, and everything about it (its place, whether it is thinned, its cap hash, its life and its orbit hash) is a hash of that identity, so it is the same point at every zoom and after a pan, and a line keeps its animation phase as you zoom. `planLod` gives the finest octave (`spacingExp`) and `thin`, a share from 1/4 to 1 of that octave's own points that follows the zoom continuously (additive: `LodPlan.thin`, `BuiltPicture.thin`, `PictureNow.thin`). The finer lattice at `thin` 1/4 equals the coarser at 1, line for line (unit-tested bytewise), so there is no pop and no fourfold density swing where the octave changes: measured on the real app at 412 x 915 over 58 zoom steps of 6 %, the worst ratio between neighbouring steps was 1.08, against 3.76 before. A new rebuild reason, `density` (`THIN_REBUILD_RATIO` 1.1: the share the zoom asks for is a tenth away from the built one, about a 5 % zoom), keeps the picture following the zoom; it waits for the same 250 ms gap as every rebuild, and the 10 % pose-zoom rule is kept.
- *The triangle budget.* The glyph pair (levels 1 to 3) is trimmed to the frame as in 0.5.0 and says `budget` when nothing fits. **The detailed streaks are never trimmed to the frame**: `segmentCap(tier, frame, own, trianglesPerSegment = 4, floorSegments = 0)` takes a floor, `DETAIL_MIN_SEGMENTS` (the High tier's cap, 12,000 segments, so the whole cap of every tier), and the layer gives it to the detailed streaks only. So **the layer no longer stays inside 550,000 triangles at level 4**: the High tier's worst case is the limit plus 2 x 12,000 = 24,000 triangles (4.4 %), and only the streaks go over it. Measured worst frame: 594,742 triangles (Katoomba forest, closest zoom, High), of which the other layers alone were already 576,104 (terrain 318,000, canopy about 200,000, roads 21,000). Why: before, in dense forest at the High tier the cap went to 0 from 454 m down to the closest zoom (43 of 58 steps of level 4 were empty), and the owner's request needs a picture at the closest zoom. The chip's and the sheet's words are unchanged; the budget line is now only ever shown for the arrows and flow lines. (0.7.0: with the relief's fix L11 reports a worst frame of 568,542 triangles; the verifier had measured 594,742 before it; the docs lane re-measured neither, and the layer's own cap is unchanged at 12,000 segments, 24,000 triangles.)
- *The batch* (`DetailBatch`, mesh name `wind-detail`): **one draw call, two triangles a segment**, animated entirely on the GPU from the view's clock (`uClock`): no texture is read, no extension is needed (WebGL1 is enough), and the CPU does nothing per frame but the fade ramp. 18 floats a segment (`aA`, `aB`, `aC`, `aD`, `aE`: 72 bytes). Depth: the 0.5.0 depth bias of 40 m toward the eye (a crown does not hide it, a ridge does), and the biased depth slides at most 0.8 of the way to the eye (at the closest zoom, with the camera among the crowns, 40 m is half the distance, which would leave the streaks behind every leaf in front of them), never nearer than the near plane. Fade: in over 400 ms and out over 250 ms from the frame time capped at 0.1 s; the old picture is kept until the new one is ready (`step`ped in slices of at most 8 ms, resumable), so the hand-over never has an empty frame. **Reduced motion** (`matchMedia('(prefers-reduced-motion: reduce)')`, followed live): the batch stands still at a frozen frame of the shader (3.7 s, where most lines carry a pulse), `detail: 'still'`, and nothing animates. (Since 0.7.0 the old Wind particles and the trees' swing obey it too: see *Reduced motion for the older Wind streaks and the trees*.)
- *Frame loop.* `animating` is true only while the detailed streaks are drawn in motion; L1 to L3 never animate (the glyphs still do not). With the Wind streaks on (the default) the CPU particle loop of 0.5.0 is replaced by a GPU one; with the arrows alone, level 4 starts animating where 0.5.0 sat still, the one deliberate change to plan 20.3 item 1. The 30 frames a second cap of the scene still applies to a pure animation.
- *The relief* (0.7.0, the owner's request that the streaks flow **around** tree crowns and ridges and curl into eddies in their lee, not over them; `src/render/wind/detailObstacles.ts`, new, pure, typed arrays, nothing allocated after its constructor; `detailStreaks.ts`; the numbers are `DETAIL_RELIEF` in `glyphTypes.ts`, first guesses tuned on real pictures). **Display only**: it bends the *direction* of a traced line, a step at a time and by at most 30 degrees (a line that slides onto a crown's rim takes the circle's direction there, up to a quarter turn, and one that leaves a lens of overlapping crowns up to 105 degrees: a few lines in a hundred, pinned in `detailStreaks.test.ts`); the speed, the colour bin (the model's speed at the segment's middle) and the line's pulse rate stay the model's. No new segment, draw call or triangle: the caps, 2 triangles and 72 bytes a segment stand. `DETAIL_RELIEF.enabled` is the kill switch: false, or `DetailInput.relief` absent, draws the 0.6.0 picture byte for byte (four golden hashes pin it).
  - *Riding on the canopy.* Where trees are drawn the line's plane is near the canopy top and not at the ground: `topShare` (0.85) of the canopy height at the point, weighted by the canopy cover (full weight from 30 %), from `FuelMap.canopyHeight` and `canopyCover` by reference (zero new bytes); the plane is kept under `eyeShare` (0.3) of the eye's height over the ground, at the middle of the screen (the layer passes it as `planeCapM`) and under every point of the picture (the builder takes the eye's height over the drawn ground under that point, so over a hillside that rises to the camera no stroke comes near the eye), so that a camera hardly higher than the canopy does not look along its strokes. With the first share, 0.6, the verifier's real pictures at 40 to 60 m and a tilt of 55 or 65 degrees had the plane within about 9 m of the eye, 55 % of the segments in the top tenth of the screen and 0.5 % in the bottom three tenths (0.6.0: 4 % and 7 %); at 0.3 the plane reaches the canopy's top from an eye height of that height over 0.3 (about 70 m for a plane 21 m up), and a test on a real Katoomba scene (`detailStreaks.katoomba.testing.ts`) pins the top tenth within 8 points of 0.6.0's and the bottom three tenths between 0.6 times and 8 points over it, at 40 to 80 m and at 35, 55 and 65 degrees (that scene, without crowns, at 40 m and a tilt of 55 degrees: top tenth 5.9 % and bottom three tenths 6.7 % with 0.3, 40.4 % and 4.3 % with 0.6, and 3.6 % and 7.3 % for 0.6.0). The lattice is planned for the metres a pixel covers at the strokes' own height (`liftRatio`) and a seed is tested where its lifted line is drawn, so a tilted view is not sparse at the bottom.
  - *Ridges.* Where the ground rises ahead of a step (a rise of 0.10 to 0.35 per metre along the flow, read from the 10 m ground with a forward difference of 12 m) the line slides along the contour (`beta` 0.6); head-on it goes over, as the 0.6.0 lift does.
  - *Crowns.* A tree is an obstacle where the stroke cuts its crown, an ellipsoid with its middle at 0.7 and its half height at 0.3 of the tree's height. Trees only (the placement's groups 0 to 6: not heath, shrubs or grass); a crown that would be under 8 px across at this zoom counts for nothing, and so does a tree that the canopy shader has faded out under a steep view. The obstacle is the crown's disc at the stroke's height, centred on the tree's own place, so the picture is a function of the world and does not swim while the camera orbits. The direction is the wind plus the soft doublet of potential flow past a cylinder, faded to nothing at three radii; **a line never ends at a crown**: a step that would end inside the circle of `rim` (1.1) radii slides along the circle instead (a head-on line takes the side its tiny lateral offset says and goes on along the circle until the wind carries it off), and a seed inside the circle is moved onto it; a crown wider than `ringPx` (80 px of radius) moves only 80 over its radius in px of the seeds in it, chosen by a hash of the seed, because a rim holds about one line to the lattice's own spacing; a point in a lens of overlapping crowns leaves by the nearest free direction (straight on, then 35, 70 and 105 degrees either side), and a line shut in with no way out ends. **So in a forest the lines part round the crowns and slide along their rims, and the picture keeps about the lines of 0.6.0**: the tests pin more than 0.9 of the lines and segments of the crown-free picture for a stand of 130 crowns and more than 0.65 for a mat of 300 crowns that mostly overlap, with no vertex inside a crown's disc. (The first build stopped a line at 0.85 radii and dropped a seed inside 0.8, which left a median of 64 % of 0.6.0's segments (49 to 105 %) in the verifier's real forest views, with 5 to 18 % of the lines under 50 px and whole stands bare; plan 22.1 and 22.3.) At most `maxCrowns` (1,536) crowns are kept, the scratch holding 2,048: the screen does not bound them (a ridge seen from 300 m had 2,529 qualifying crowns), and when more qualify the **largest on the screen** are kept, from everywhere, in two passes over the trees (the first counts them by radius, the second keeps every crown above the size where the count passes the cap and a hash sample of that size), where the first build kept the first 1,024 in the order of the trees and left a part of the picture bending round none.
  - *The pin.* Each line carries a pin from 0.05 to 1 in its colour alpha (always 1, and unused by the shader but for the drop test, in 0.6.0), which the shader multiplies the meander by, so that a line bent round a crown is not carried through it again by the 60 m octave of noise.
  - *Eddies.* Counter-rotating Rankine vortex pairs are added to the traced field, 1.7 radii downwind of the site and 0.9 radius to either side, behind **(a)** a crown that stands 3 m proud of the stand with no other obstacle near, **(b)** the lee of a ridge (candidates on a fixed 48 m world lattice where the lee factor is at least 0.6, the ground falls at least 0.25 along the flow and is 12 m higher 60 m upwind) and **(c)** the fire's plume (one site at the fire's intensity-weighted centre, `src/render/plumeSite.ts`, which `SceneView` hands over with `setPlumes` for each snapshot: strength `min(1, the hottest cell's intensity / 20,000 kW/m)`, radius 30 + 90 x strength metres). At most 32 sites, kept by a hash priority of one half on the site's own place (the same tree has a wake or has none in every view), and only where a core would be 10 px across. The existing pulse then runs round the curl, so the swirl turns on the screen.
  - *For which wind.* The trees and the plume are for the wind read at the ground's own level, **What the fire feels and 10 m** (`RELIEF_TREE_MAX_M`): a wind read 50 m or more above the ground flies over the canopy and bends for no crown or plume, and the ridge terms fade with the height as the ground terms do.
  - *Rebuild reason* `'canopy'` (after `'height'`): a new forest placement (`VegetationLayer.crownSource().serial`) or canopy, or the relief switched, makes one rebuild, held to the usual 250 ms gap. The crown source is empty, and its serial moves, when the canopy layer is off, hidden by a solo heat map or faded out in a top view: the strokes then stay at the ground as in 0.6.0.
  - *Cost.* The builder reads 8 more numbers a step for the canopy, 3 ground reads for the ridge terms and a lookup of 1 to 4 grid cells for the crowns near a point; `detailStreaks.perf.test.ts` holds the median of a whole High-cap rebuild without the relief under 10 ms, and the rebuild with it (a canopy, 700 crowns, a plume and rolling ground) under three times that and under 30 ms: measured here a median of 11.8 ms against 4.7 ms (x2.5, node, a shared machine; L11 reports 12.2 against 4.9), the slices at p95 3.8 ms and at most 7.9 ms (L11: 3.67 and 5.62); and `detailStreaks.alloc.test.ts` holds a rebuild to under 1 kB (the relief's numbers are worked out inside `walk`, because a function that runs once a rebuild stays interpreted and boxes every number it makes). The crowns' scratch is allocated once, with the builder. The figures of the verifier's measurements are in plan 22.1.
- *The idle stop* (0.7.0, `src/render/idleStop.ts`, pure; `SceneView`). After `IDLE_STOP_MS` = 60,000 ms with no activity the whole view holds still: the shader clock `uClock` stops, so every ambient animation freezes on the same frame (the detailed streaks, the trees' sway, the flames' flicker, the terrain's fire shimmer, the markers' pulse and the smoke's slow drift), the CPU Wind particles and the embers are not advanced, the frame loop's ambient terms are held back and the view stops drawing (the `requestAnimationFrame` callback itself keeps running and returns at once, as it does for any still map). **Activity** is a `pointerdown`, `pointermove`, `wheel`, `keydown` or `touchstart` anywhere in the page (passive capture listeners on `window`); a camera that moves, a hand on it or a flight; a new picture of the fire (`SceneView.update`: the head moving, a scrub, any change of the time shown); and `setLayers`, `setViewMode`, `setScenario`, `refreshFuel`, `setIgnitions`, `setInsights`, `resize` (a turn of the phone), `setCovered(false)` and the page coming to the front again. **A running simulation never lets the view hold still**: it pokes with every snapshot. Not activity: the layers' own work (a rebuild or its swap, a fade, the forest being placed), the chip's poll four times a second, a timer. On waking the clock goes on from where it stopped (the first frame's step is capped at 0.1 s), so nothing jumps, and a gap of more than 5 s between frames (a locked screen) counts as the page having been away. Reduced motion is unaffected (the streaks already stand still, and `detail` says `'still'`, never `'paused'`). **Nothing appears on the map when it pauses**: `WindGlyphStats.detail` is `'paused'`, the Wind detail sheet says "The streaks paused to save battery. Touch the screen to move them again.", the line under the Wind height chips "Showing streaks with small eddies, paused to save battery. This is the most detailed level." and the debug statistics' Wind glyphs row "detailed streaks paused". **Projector use: with nobody touching the screen the view looks hung after a minute** (a touch wakes it). The test seam is `SceneViewOptions.idleStopMs` and `window.__firesimIdleStopMs`, read once when the view is built (`idleStopLimit`: a number of ms, 0 or `Infinity` for never, anything else is the 60 s); `e2e/fixtures.ts` sets it to 0 for every spec (several wait longer than a minute with the view up) and `e2e/wind-motion.spec.ts` sets 3,000 ms. **The battery it saves is not measured**: the check is the battery percent over 10 minutes with the app untouched and the screen on, on 0.6.0 and on this build; the arithmetic is that a minute at the 30 fps cap is 1,800 frames of a whole scene.
- *Reduced motion for the older Wind streaks and the trees* (0.7.0, `WindLayer.setMotion`, `VegetationLayer.setMotion`; the 0.6.0 gap "the old Wind streaks ignore reduced motion" is closed). Under `prefers-reduced-motion` the older CPU Wind streaks stand still where they are, drawn from the wind as it is at full strength (a frozen frame holds no half-faded comets) and redrawn from it when a new snapshot arrives, and they ask for no frames; the trees stop swaying (the swing and the flutter go to 0 and the layer's `animating` is false) but **keep their lean**, so the direction of the wind still shows (with both at 0 the gust stays at its mean, so the lean stands still too). Flames, embers and smoke are the fire itself and keep moving. The sheet's *still* limit applies at every zoom while a Wind streaks switch is on, not only at level 4.
- *The cold first zoom* (0.7.0, the 0.6.0 verifier's cost). `lowest()` no longer walks the 160,000 cells of the drawn mesh (`HeightField.minElevation` is read: `GroundRaster.minElevation`); the first two rebuilds of a builder read the clock after every 8 cells and every line (the next two after 256 cells and 4 lines, then 2,048 and 16), and the first two slices of each builder take 4 ms where the budget is 8; the detail shader's program is compiled ahead when the first wind data arrives (`WindGlyphLayer.precompile`: `compileAsync` where the context has `KHR_parallel_shader_compile`, else one synchronous `renderer.compile` at that quiet moment; it asks with `extensions.has`, so no console warning is made where the extension is missing); and `WindGlyphStats.tickMaxMs` reports the layer's own longest tick. The verifier's result on the real app: the cold first zoom is **not shown improved and shows no regression**; the long tasks at 4x that are not the layer's (the vegetation's re-placement, the markers, first-time code) are not fixed.

**Cost** (the figures are the fix lanes' and the verifier's, taken after the nested lattice and the floor, on the node tests of `src/render/wind/detailStreaks.perf.test.ts` and `detailStreaks.alloc.test.ts` and on the real app in software GL on a shared machine; the docs lane did not repeat them, and its first figures of 836 lines and 11,438 segments are those of the 40 px lattice):

| Item | Figure |
|---|---|
| Rebuild (node) | a High build a median of about 2.5 ms (1.9 ms before the nested lattice: four times more cells are walked); a phone-size orbit view (570 to 720 lines) 1.4 to 1.8 ms; the worst case, a 2560 x 1440 orbit view, 19 ms in 6 slices |
| Rebuild (browser, software GL, shared machine) | the whole rebuild 8 to 9.5 ms on average, in 2 slices; at a 4x CPU slowdown the slice p95 is 8.5 ms and the maximum 11.1 ms. The cold first zoom into level 4 at 4x costs slices of 10 to 15 ms against the 8 ms budget and 2 or 3 long tasks of 52 to 98 ms, once per session (a follow-up) |
| Allocation | 330 to 540 bytes a rebuild, and the heap stays flat over 3,000 rebuilds |
| Draw calls and triangles at 412 x 915 | level 3 adds 3 draw calls and 8,392 triangles (integration lane); level 4 adds 1 call and 2 triangles a segment, and holds about 460 to 860 lines. The integration lane's level 4 figure of 1,704 triangles (852 segments, 76 lines) was taken before the floor, when a dense forest at the High tier left the streaks almost no room (inferred, not re-measured); the High tier's worst frame was 594,742 triangles (*The triangle budget*) and, after the relief's fix, 568,542 in L11's measurement (not repeated by the docs lane) |
| Memory | the builder's output and the batch's own copy are 72 bytes a segment each: 864,000 bytes each at the High cap (derived), both made when the layer is made |
| Bundle | 0.6.0: the entry 172.7 kB gzip of 195, all JavaScript 980.5 kB of 1000 (the integration lane had 172 and 979.8); no budget was changed (the sheet is the 1.27 kB lazy chunk above). 0.7.0: see *Build the phone apps* |

**Honesty.** At the closest zoom a whole screen lies inside a few model cells, one smooth bilinear patch, which is why 0.5.0's long flow lines read as a diagram of parallel arrows. The detailed streaks keep the model's direction, speed and colour and add the look of turbulence from the ground's shape; they are not a finer simulation, they do not show the fire's own plume or any eddy the model computed (the model has none at this scale), and **the sheet says "added for looks"** (an owner decision, plan 21.5). Nothing about the look, its cost or its battery use has been seen on a phone; the width, the amplitude and the density are first guesses seen only in software GL.

**Known gaps.** *Closed in 0.7.0:* the streaks no longer pass over the crowns (*The relief*), the older Wind streaks obey reduced motion, the debug statistics' "Wind glyphs" row says what it draws and which switch feeds it, and the cold first zoom's layer-side costs were cut (2 or 3 long tasks of 52 to 98 ms once per session at a 4x CPU slowdown were the 0.6.0 figure; the verifier did not see them improved, and saw no regression). The `flowGlyphs` hash was read: its xor of three products collides only between a cell and its point reflection through the world origin (about one cell in three has such a twin, and away from the origin none has), the twin is on the other side of the picture with the same jitter offset, and nothing can be seen of it, so it is **left as it is**, with a comment and a test, and every result is the 0.6.0 one. *Open:* the look of the relief, its cost and its battery use have been seen only in software GL, never on a phone, and the `DETAIL_RELIEF` numbers are first guesses; the fix for the relief's three verifier findings (the plane's cap, the crown cap, the lines kept in forest) was looked at by its own lane's before and after pictures and tests and **not by an independent verifier** (plan 22.4); the cap under the eye still steps about 1 m a rebuild while the camera tilts, and a camera jump builds twice (L11 reports the two pictures now at 90 to 97 % of each other's segments); the idle stop's saving is not measured; the long tasks at the cold first zoom that are not the layer's are untouched.

## Wind direction

**What it is** (0.6.0, request 4 of the owner: "The Local wind feature should be a global wind direction changing feature called just simply Wind direction. You give it a new wind direction and an optional time and it changes the wind direction then."; plan section 21). Tools has **Wind direction** where it had Local wind. It turns the wind of the **whole map**: there is no crosshair, nothing to place and no radius. The old per-place tool, which put a wind reading on a point with a speed and a radius, is gone as a tool; the `WindEdit` record stays in the scenario for Setup's **belt-kit** readings (online only), which the panel lists and can remove (below).

**What a change does** (settled with the owner, `src/scenario/windDirection.ts`):

- The **turn starts at the chosen time** and the direction is reached `WIND_TURN_S` = 900 s (15 minutes) later, by the shortest arc (an exact half turn goes clockwise), eased with a smoothstep. The start is a **whole minute** of simulation time (the step grid follows the display step and must not move it: plan section 4, rule 1): the time you choose is rounded up to a whole minute, never before the time you are looking at, and at most the last whole minute that is at or before the end minus one minute (`windDirectionTime`); the last minute of a scenario takes no change ("There is no time left in this scenario for a wind change.").
- Then the direction **holds** until the next change: **the forecast's later direction changes are replaced** (with a change made at 12:00, a swing that the forecast has at 15:00 no longer happens). The forecast's own veer with height is kept (the whole column turns by the same angle as the 10 m wind: the wind profile and the pressure levels).
- The **speed is untouched**: the forecast's speed, temperature, humidity and every other field stay the forecast's, bitwise. The turn is made of stamps added to the forecast series, one at most every 15 degrees of arc (`WIND_TURN_STEP_DEG`, `ceil(1.5 x arc / 15)` segments, the 1.5 being the steepest slope of the easing), and because stamps are linear in u and v a big arc dips the speed between stamps (the contract's scout measured up to 0.85 % with 15 degree stamps); the series the engine and the top bar read is that one, so the fire, the embers, the air slices, the arrows and the top bar follow with no change in `atmosphere/`, `fire/` or `embers/`.
- **Several changes** apply in (time, insertion) order; one that starts inside a turn cuts it and starts from the direction reached.
- **Remove** (the bin button on a row of "Your wind changes") takes a change away **as if it had never been made**, like removing an ignition: the run is re-simulated without it **from when the change was made** (0.7.0; 0.6.0 re-ran from its start). The explain engine counts a change from the moment it was made (below), so the cards and the Dead man zone it raised since, and the checkpoints taken since, carry it and go with it: `windRerunFrom(edit)` is `min(madeAt, start)`, and a change without `madeAt` (a scenario edit) keeps its start. The announcement says so when the simulation had computed past that time. **Back to the forecast** does the same for every change at once. If you are looking at an earlier time, applying a change also re-runs the simulation from there, and the panel says so ("You are viewing 14:10. Applying re-runs the simulation from then.").
- **Readings.** A local wind reading (Setup's belt kit) keeps its own direction inside its radius when the wind is turned. The panel lists them under "Wind readings" (where they are: "near the middle", or "2.1 km NE of the middle"; the direction and the radius; when they start; "from the belt kit") with a Remove for each. **Removing a reading stops it from then on**; what was simulated before stays.
- **What the person sees after a change.** The top bar's wind chip and the Weather tab's tiles and chart show the wind actually in force (`Session.windWeather()`); the Weather tab says "You changed the wind direction, so the forecast's later wind changes no longer apply." and the forecast's wind-change card (Insights and the Weather tab), the timeline's marks, the chart's marks and the Danger zone built from the swings that the change replaces are not shown (a forecast swing that comes before the change starts is still shown and still counts). **Since 0.7.0 a change of the person's own has cards of its own and a way back** (below): a wind change card, a Dead man zone, a timeline mark of its own and *Back to the forecast*. **The 0.6.0 gap is closed:** a forecast swing after a scheduled change's start no longer raises a Danger card before the change begins, because the engine leaves the swings the change replaces out from the first cycle after the change was *made*; a card raised before that stays as history, and the forecast's S13 and foehn cards still read the forecast direction.

**The panel** (`windPanel.ts`, DOM; `windPanelModel.ts`, pure and unit-tested; `sim.css` `.wind-*`). In order: a hint ("Choose where the wind comes from. It turns over 15 minutes and then holds that direction, so the forecast's later wind changes no longer apply. Wind speed stays as forecast."), the **dial** (`compassRose`, opens on the wind as it is now to the nearest 5 degrees, so a dial left alone is within half a step of the wind; its size follows the window's height: 184, 148, 140 or 120 px; drag the arrow or use the arrow keys), **When** (a `segmented` of Now, In 10 min, In 30 min, In 1 h, At a time), the **time field** (only for At a time: "Local time", `<input type="time" step="60">`, prefilled with the clock of the Now start plus 10 minutes; a clock time of the scenario's own zone, never the device's, taken as the first such time at or after the Now start), a status of two lines ("Before the change: from NW (315°)." and "Starts turning at 14:41 and reaches SW (225°) by 14:56."), a note when you are looking at the past, and the list of the changes (and the readings) with, under the changes, **Back to the forecast** (0.7.0: a secondary 44 px button, `wind-back-to-forecast`, and the hint "Back to the forecast takes away every wind change you made, as if you had never made them. The simulation is computed again from when you made the first one."; it is there while the list of changes is not empty, leaves the belt-kit readings alone, and puts the keyboard on the dial because the button is gone; the announcement is "Back to the forecast. 2 wind changes removed. The simulation re-runs from 14:40 without them.", the last sentence only when the simulation had computed past that time). **Apply** is the one primary button in the fixed foot and says what it will do: "Turn wind to SW", or **"Hold wind from NW"** when the dial is already on the wind within half a step (it keeps that direction and drops the forecast's later changes: "Holds NW (315°) from 14:41. The forecast's later wind changes no longer apply."). A time that cannot be used says why under the field ("Enter a time such as 14:35.", "That time is not in this scenario (14:00 to 18:00).", "That time has passed. Choose a time after 14:41.", "The scenario ends before that time.", "The last time you can choose is 17:59.") and Apply is off. After Apply the panel stays open. Every sentence is announced politely in the live region, never a toast or `role=alert`.

**360 x 640 rule.** A small portrait phone (under 700 px high) cannot show the status under When without scrolling, so a **one-line plan** ("Starts turning at 12:00, done by 12:15." or "Holds NW (315°) from 12:00.") sits over Apply in the foot, which is always in view, and the longer second status line is hidden there (`@media (orientation: portrait) and (max-height: 699px)`); the dial gives way (140 px at 640 px high, 120 px under 560) and the list scrolls. On a short landscape screen (844 x 390) the dial's read-out goes beside it and the hint under both, so the whole dial is in view on opening.

**The engine** (`src/sim/simulation.ts`, `records.ts`; plan 21.3 for the corrections to the contract). The change is a `ScenarioEdit` member, `WindDirectionEdit { kind: 'windDirection'; id; dir; time }`, sent as an ordinary record through the existing `edit` and `removeEdit` messages (no protocol change; the in-thread fallback runs the same `Simulation`; the demo engine honours it too). `Simulation` keeps a **second weather series, `wx`**: the forecast with the active changes applied (`applyWindDirection`), which **is** the forecast object while there is no change. `wx` feeds only the atmosphere's stamp pair and the direction fields of `weatherNow`; moisture, heating, the stable night, the speed and the forecast cards keep reading `scenario.weather`. A change applies and rebinds the stamp pair without re-solving what did not change; removal is the `undoRecords` branch shared with `removeIgnition` (restore the checkpoint at or before the change and replay). `SimStateView.windOverrideFromMs` makes `InsightEngine.update` drop the forecast changes at or after the first change's start from the analysis, so the cards and the Danger zone are not raised for swings that no longer happen. The in-run record of a change is not persisted: no schema.

**The cards and the Dead man zone of a change of your own, and the gap closed** (0.7.0, `windDirection.ts`, `simulation.ts`, `explain/`, `session.ts`; plan 22.1). `WindDirectionEdit.madeAt?` is the view time when Apply was pressed (`Session.setWindDirection` sets it, at most the start; absent means the start). It never reaches the weather, the atmosphere, the fire or a snapshot hash, so a run is bitwise the same with or without it. `Simulation.windKnown(time)` says which changes the explain engine may count at a step time: those of the record list made *before* it (`windRerunFrom(e) < time`, strictly, because the cycle at the step that ends at `madeAt` has already run when the change is made and a replay of it must say the same), so one scheduled for later counts from the first cycle after it was made, though its record applies only at its start. That is a pure function of the record list and the step time, so a replay from any checkpoint reproduces the first run's cards. It gives `SimStateView.windOverrideFromMs` (the earliest start: the forecast's later swings are left out from there, which is what closes the gap) and `SimStateView.windUserChanges` (`SimWindChange`: id, start in unix ms, `fromDir` in force at the start from `planSwings`, `toDir`, and the forecast's 10 m speed at the start and 15 minutes later, `userWindChanges`), memoised on the ids, directions and times. `InsightEngine` turns every one that passes the forecast's own thresholds (a turn of 45 degrees or more and a wind of 15 km/h or more after it, so "Hold wind from NW" raises nothing) into a `WindChange` with `user: id` and merges it with the forecast's by time. `rules/weather.ts` then makes, for each, a `wind-change:user:<id>` card (the flank that becomes the head) and, while its start is ahead and at most an hour away (`dmz.horizonS` 3,600; gone the moment the turn starts), a `dead-man-zone:user:<id>` card and layer: **severity Watch ("Watch out"), not Danger**, so the Danger gate (the vibration and the opt-in pause) never fires for what the person did themselves; a key of its own, so a shown forecast card never holds the machine for it, and `insightSignature` keeps it apart from the forecast's card at the same place and minute. The words (`explain/text.ts`): "Your wind change: this flank becomes the head" with "You set the wind to swing from the north-west to the south-west, starting at about 2:40 pm (in about 10 min). It takes 15 minutes to turn. When it has, this 1.2 km flank becomes the front and runs at full speed almost at once. A wide front moves fast and is hard to stop." and "Dead-man zone for your wind change" whose body says the change you set "starts in ... and takes 15 minutes to turn" and that "the slow turn means the first minutes reach less than this" (the zone is what the full new wind alone would reach in 5 minutes from the perimeter now, so it overstates the first minutes of an eased turn; a "Now" change, starting within 59 s, has a card and no zone). The demo engine counts a change from `madeAt` too and raises its own Watch card in the same words (`compassWord` moved to `core/units` so both say "from the west to the south"). `Session.backToForecast()` removes every `windDirection` edit as if never made, earliest first by `windRerunFrom` (the first removal restores the checkpoint at or before it, the later ones only drop their records), keeps the belt-kit `WindEdit`s, cuts history from there and drops the removed changes' own cards by key; with none it sends nothing. The timeline marks every change of the person's own (`tl-mark-own`, always, since it is no prediction). The 15-degree stamp step `WIND_TURN_STEP_DEG` is **unchanged**: no measurement said it should be 20.

**What the independent verifier measured on the real engine** (Katoomba, 6 km; not repeated by the docs lane): with **no change** every result is hash-identical to before the feature on both tiers; the same change made twice gives the same result; on the **fast tier** the fire's wind follows the ambient turn within about 6 degrees; on the **standard tier (3-D air)** the ground wind can lag or overshoot the ambient by up to about 15 degrees during the turn and settles within minutes (the contract expected 17 to 25 degrees and that was not reproduced; the engine test allows 25 degrees while turning and 5 degrees 30 minutes after). The Help therefore says that on the 3-D settings the wind near the ground can lag a little behind a big turn. Cost: about **+2.2 s over a 60-minute standard-tier run** in the worker (+0.4 s on the fast tier), no stall; the extra work is one more background solve each time a stamp the turn made is crossed.

**Limits.** Phone behaviour is unmeasured (the cost above is a desktop, in the worker). Fallback if the extra solves hurt on a phone: raise `WIND_TURN_STEP_DEG` from 15 to 20 degrees (fewer stamps, a coarser turn). No per-place wind any more (the belt kit's readings remain). **0.7.0:** the cards, the zone and *Back to the forecast* are built; **a card raised before a change was made stays as history** (the Weather tab's one line says the forecast's later changes no longer apply, and the card keeps its own time); a removal re-runs from when the change was made, so for a change set well ahead that lead time is run again too; the zone's two honest limits are in the card and in Help (it assumes the whole new wind at once, and it exists only while the change is ahead, at most an hour). The 3-D lag with a fire present and on the High tier, and the cost on a phone, are still unmeasured.

## Data sources and licences

| Source | Used for | Licence |
|---|---|---|
| NSW Spatial Services (NSW_5M_Elevation) | ground height of the demo sites (a 5 m model the service says is derived from stereo imagery, bundled at 10 m) | © Spatial Services NSW, CC BY 4.0 |
| NSW Spatial Services (NSW_Imagery) | aerial photos of the demo sites (a mosaic of flights from several years; display only) | © State of NSW (Spatial Services), CC BY 4.0 |
| SRTM via AWS Terrain Tiles (Mapzen Terrarium) | ground height (about 30 m) outside the demo sites | public domain (NASA/USGS SRTM), AWS Open Data |
| Meta & World Resources Institute | tree canopy height and cover (High Resolution Canopy Height Maps v1, Tolan et al. 2024) | CC BY 4.0 |
| NSW State Vegetation Type Map (SVTM) | vegetation formations and classes → fuel types | © State of NSW and DCCEEW, CC BY 4.0 |
| NSW National Parks and Wildlife Service | fire history (wildfires, prescribed burns) | © State of NSW and DCCEEW, CC BY 4.0 |
| NSW Spatial Services (roads, fire trails, addresses, place names) | the Roads, Fire trails, Homes and Place-names layers | © Spatial Services NSW, CC BY 4.0 |
| NSW Planning (land zoning) | residential, village and other built-up zones | © State of NSW and Department of Planning, Housing and Infrastructure, CC BY 4.0 |
| Open-Meteo | forecasts (automatic 'best match': the model Open-Meteo judges best for the location; the answer does not say which), past weather, the drought history | CC BY 4.0 (free for non-commercial use, which includes education) |
| ECMWF IFS (through Open-Meteo) | forecast fallback, upper-air levels, the 2019/20 historic fire days | CC BY 4.0 (ECMWF open data) |
| NOAA GFS (through Open-Meteo) | upper-air levels only when the ECMWF levels are missing | public domain |
| Copernicus ERA5 (through Open-Meteo) | past weather before 2016, the year of daily rain behind the drought index, the 2013 historic fire days | CC BY 4.0 through Open-Meteo; contains modified Copernicus Climate Change Service information |
| NSW Rural Fire Service feeds, Geoscience Australia DEA Hotspots | **not used yet**: the app can read them (`scenario/feeds.ts`) but shows nothing from them | © NSW RFS (information only); CC BY 4.0 |

The same list is in the app (Settings → Data and licences, `ATTRIBUTIONS` in `src/ui/content.ts`); a test
(`src/scenario/datasets.test.ts`) checks that every credit line a scenario carries appears there. The bundled demo data are in
`public/demo/<site>/` (each file's `.json` names its source; `public/demo/provenance.json` lists every file's size and capture
date) and the historic weather in `public/replays/`.

## Data sets and provenance

Every scenario carries an inventory of the data that went into it: `ScenarioData.datasets` (one `DatasetRecord` per data
set) and `ScenarioData.datasetSummary` (totals, substitutes, the model grid, a reproduction recipe, working memory). The
contract is `src/core/datasets.ts`; the Data sets screen, the map credits and the exports read it and never guess.

**What is recorded, per data set** (terrain, aerial photo, vegetation, canopy height, fire history, weather, upper air,
rainfall history, roads, fire trails, homes, zones, place names, the derived fuel map, your input, the bundled demo site):
what it is and what the simulator uses it for; provider, licence and credit line; the services and files read (host and
path only, never a query string or key); format and kind; **status** (`used`, `partial`, `fallback`, `unavailable`,
`skipped`, `user`) and **origin** (`live`, `cache`, `area-pack`, `bundled`, `synthetic`, `preset`, `user`, `derived`) with the
reason for any substitute; vintage (capture date as published, when this copy was obtained, version, "current to",
weather age and the 6 h / 24 h staleness rule of docs/research/08 §5.5); coordinate system and how it maps to the model's
local metres; extent and the share of the model area really covered (and what filled the rest); resolution and size as
published vs in the model and the resampling; **sizes** (bytes obtained, of which over the network and from stored copies,
decoded bytes, memory held, requests, tiles/features/records, time, bytes stored on the device); plain-English statistics
(elevation, slopes, fuel classes, canopy percentiles, time since fire, weather ranges, road km, home counts, zone areas...),
a distribution for a spark bar, the heat-map layer to show it on, how far to trust it (`measured` → `synthetic`) and its
limitations.

**Where the numbers come from.** A request ledger (`src/data/ledger.ts`) is created for each build and passed to every
loader; the HTTP layer, the cache, the asset loader and the area-pack store record each request under the data set it is
for (every attempt, retries included; bytes on the wire from Content-Length or the platform's resource timing, else the
uncompressed size flagged as such, because compressed answers on the device do not say how big they were on the wire;
stored-copy hits with their size and date, bundled file sizes), so sizes are measured, not typed in. Statistics are computed once from the finished grids (`src/scenario/datasetStats.ts`).
Only documented static facts are typed in (provider and licence names, service copyright text). Bundled files report their
real byte length and the capture date from `public/demo/provenance.json` (`npm run provenance` regenerates it; a test
checks it against the files).

**Before a download** `estimateScenarioData(request)` (`src/scenario/estimate.ts`) plans the same records with the likely
origin, an estimated size range and its basis (exact for bundled files and packs; tile counts x measured tile sizes; bytes
per km² of the bundled areas; measured response sizes), and whether the scenario works with no signal. Planned sizes are
the UNCOMPRESSED answers, an upper bound: the services compress JSON 3 to 8 times on the wire. A live build at Bilpin on
2026-09-30 (`tests/fixtures/datasets/live-nondemo.json`) moved 2.3 MB over the network, 3.6 MB uncompressed: terrain 1.8 MB
in 16 PNG tiles (not compressible), vegetation 140 kB (957 kB uncompressed), fire history 113 kB (387 kB), zoning 55 kB
(212 kB), roads 102 kB, forecast with upper-air levels 22 kB (77 kB); that day Open-Meteo's archive refused with its daily
request limit (HTTP 429), so the rainfall history fell back to the defaults, with that reason on the record. The estimates
bracket each uncompressed size (`src/scenario/datasets.live.test.ts`, `NET=1 NODE_USE_ENV_PROXY=1`).

**Working memory** (`src/scenario/memoryModel.ts`): what a run holds, from the real grid sizes: the scenario (measured; held
twice, by the screen and the worker, which does not get the roads, homes and names), the worker's two fuel-map copies
(measured), the engine's arrays per part (coefficients measured from the engine's allocations
and re-checked by a test against `Simulation.memoryReport()`), checkpoints, the time-scrubber history (capped by its
budget) and an estimate of GPU memory. A 9 km Katoomba run at 30 m on the standard tier holds about 420 MB in all.
`liveMemory()` reads the WebView's JavaScript heap when the device reports it and says so when it does not.

**What the screen says about the engine.** The summary written at build time only knows the tier that was *asked for* ('Auto' on most
phones). Once the engine reports, the Data sets screen shows the engine's own tier, why it was chosen (the auto-tune's timing) and its
air or wind grid, sizes the working memory for that tier (the fast tier holds about half of what the 3-D air does) and adds what the
engine itself measured (`EngineInfo.memory`, with the simulated time it was measured at). The statistics of the roads, trails, homes,
zones and names are for the model area only (the loaded map reaches a margin beyond it); 'Real data cover' is only said of data that
were obtained, and a designed, typed or worked-out data set says what it is instead ('Covers 100 % (made up by the app, not real data)').

**On the device** `storage.report()` (`src/data/storage.ts`) lists the bundled demo data, the stored copies by kind and
place with their dates, and the saved area packs with their items; `storage.clearCache(kind)` and
`storage.deleteAreaPack(id)` are for the screen to call after the user confirms (nothing calls them automatically).

**Exports and fixtures.** `datasetsToText`, `datasetsToCsv` (one row per data set, or per statistic) and `datasetsToJson`
(stable, sorted) give the same inventory for sharing. `tests/fixtures/datasets/` holds three real inventories for UI work:
`katoomba-bundled.json` (a demo site offline), `live-nondemo.json` (the live Bilpin build; `live-nondemo.plan.json` is
its Setup plan) and `offline-synthetic.json` (a non-demo place with no signal: every substitute). `?mock=1` scenarios carry an honest mock inventory
(`src/ui/mockDatasets.ts`).

**Adding or rebuilding a demo site.** List it in `src/data/demoSites.ts` (an id of lowercase letters only, the centre; the
square is 9 km), then run `NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-site.mjs <id>`. It runs, one after the other, the
fetchers for the Terrarium tiles, the NSW 5 m elevation model (`fetch-demo-dem5m.mjs`), the aerial photo
(`fetch-demo-imagery.mjs`, which needs Python 3 with Pillow for the JPEG), the canopy height, the SVTM vegetation
(`fetch-demo-vegetation.mjs`), the NPWS fire history (`fetch-demo-fire-history.mjs`) and the places context, and then
rebuilds `public/demo/provenance.json` (`npm run provenance` does that alone). Files that already exist are never overwritten
without `--force`. Re-running Katoomba into a scratch folder (`--out=<dir>`) reproduces the committed files: the same
dimensions, headers and encodings, elevations within 0.1 m (rms), 96 of 96 fire-history polygons identical and the aerial
photo within about 1 of 255 grey levels per pixel (`docs/research/08b-live-endpoint-verification.md`, section 10).

## Run it

Requirements: Node 20+ (22 used here), npm.

```bash
npm install
npm run dev          # http://localhost:5173 — the dev server also proxies the canopy-height bucket (no CORS)
npm run build        # typecheck + production build into dist/ (relative URLs, module worker bundled)
npm run preview      # serve dist/ on http://localhost:4173
```

URL parameters (development, demos, tests): `?mock=1` runs the UI on the mock engine, 2-D map and mock builder (no
WebGL or worker needed); `?theme=light|dark` and `?contrast=high` (for the session; Settings keeps them); `?notice=1` shows the
safety notice again; `?debug=1` exposes
`window.__firesim` (session, view, scenario) in a production build, and with it `&paceLevel=ok|behind|waiting` shows the speed
signal on the timeline without a slow phone (screenshots and layout audits).

### Tests

```bash
npm test                          # Vitest: every module incl. the §15 validation scenarios (3,331 tests at the 0.3.0 gate; the 0.4.0, 0.4.1, 0.5.0 and 0.6.0 counts are in the plan, sections 18.2, 19.2, 20.2 and 21.2)
npm run check:contrast            # WCAG contrast of every text pair of every stylesheet in the four looks
npm run build:cap && npm run check:bundle   # the APK build: one page, no source maps, JS / CSS / data within the budgets (docs/ARCHITECTURE.md, Performance budgets)
FIRESIM_SKIP_SLOW=1 npm test      # skip the long 3-h Katoomba validation (src/sim/validation.test.ts)
SLOW=1 npx vitest run src/sim/validation   # include the long §15 scenarios (night, 6 h runs)
npx vitest run src/fire           # one module
npm run typecheck                 # tsc --noEmit
```

### End-to-end tests (Playwright)

```bash
npx playwright test               # builds, serves dist/ on :4173 and runs e2e/ on the Pixel 7 profile
PW_CHROMIUM=/path/to/chromium npx playwright test   # another Chromium (default /opt/pw-browsers/chromium)
```

Chromium runs with SwiftShader WebGL (no GPU needed). The server is reused if one is already running on :4173 — run
`npm run build` first so it serves the current code. The specs:

- `e2e/app.spec.ts` — the whole app with the **real modules**: safety notice → Katoomba demo (offline) → preset
  weather → build → mark a fire on the Megalong escarpment with the crosshair → play at maximum speed → the fire grows,
  grouped insight cards appear, "Why here?" explains, arrival overlay with its map legend, cross-section in the 3-D
  atmosphere, eye level, a jump back with the time menu, a fuel brush edit and a spot fire in the past, undoing the spot
  fire, then a jump far beyond the computed range that is cancelled part-way and an exact jump. Checks that nothing
  pops up over the simulation and playback never stops by itself. Writes the screenshots in `docs/screenshots/`.
- `e2e/sim.spec.ts` — the real engine in its Web Worker: timeline jumps (forward beyond the computed range, cancel,
  exact landing, a 10 s picture interval) and a whole scenario at maximum speed without a pop-up or a pause.
- `e2e/ui.spec.ts` — the UI on the mock engine (`?mock=1`): the collapsed menus and dock, the speed options, the
  timeline, the opt-in pause on Danger cards, settings and the belt weather kit.
- `e2e/layers.spec.ts` — the Layers panel against the catalogue, heat maps, solo and plain ground, remembered choices, no GPU leaks. Since 0.5.0 also the *Arrows and flow lines* row: a switch row in Wind and air whose six *Wind height* chips are built when it is first on, remembered (and back after Reset), with the panel's DOM counted (at most 1,000 nodes with the row on); on the real layer, the map legend card and the caption and zoom line following the camera, and the card giving way at eye level and coming back; on the 2-D stand-in map, "Needs the 3-D view" and no chips.
- `e2e/datasets.spec.ts`, `e2e/model-card.spec.ts` — the two information screens: their numbers equal `window.__firesim`'s.
- `e2e/integration.spec.ts` — the seams: every entry point to Data sets and the model card, the Back order, focus returning, the stage
  inert behind a screen, the reviewers' follow-ups (the weather chip is not a button, Tab never leaves Settings for the map, Play has
  no aria-pressed, backgrounding cancels a fast-forward), high contrast, the 200 % font scale at three phone sizes, deletions that ask
  first, and a whole run in which every screen is visited and nothing pops up or pauses it.
- `e2e/truth.spec.ts` — the truth audit of the two information screens on the real engine: the tier the Data sets screen names is the
  engine's (whatever the auto-tune picked), its memory is sized for that tier, the places figures are for the model area, a designed weather
  is never "real data", and the card's layer list agrees with the tier about the smoke and the wind.
- `e2e/gallery.spec.ts`: takes the pictures of the new screens for `docs/screenshots/` (see above; the 0.4.0 tests are `gallery 0.4.0`, the 0.4.1 test is `gallery 0.4.1`, the two 0.5.0 tests are `gallery 0.5.0`).
- `e2e/android.spec.ts` — the app under an emulated Capacitor Android runtime.
- `e2e/maps-link.spec.ts` — Setup's "paste a Google Maps link or coordinates" box: a long Mount Tomah link, Google's share text, the Paste button,
  a short link under the emulated Android runtime (`e2e/androidBridge.ts` fakes the native HTTP plugin's redirect, so no real network is used) and in the
  plain web build, rubbish and route links, Clear, the remembered setup holding coordinates only, labels and tap targets; takes `27-maps-link*.png`.
- `e2e/debug-stats.spec.ts`: the Simulation debug statistics screen. It opens from Setup and Settings before any run, and on the real engine from
  the menu row directly under Settings while the run plays (without pausing it); values change in place once a second; Copy gives plain
  text with the group titles, an end marker and no coordinates, and a box to select from when the clipboard is refused; Back and Escape
  close it and focus returns; no pop-up, no network call, text and targets in the three looks.
- `e2e/pace.spec.ts`: the speed signal. On the real engine under the Detail profile at 3600× the 44 px button appears after its wait,
  announces itself once and never as an alert, its sheet opens only on a tap, and "Play at N×" clears it; with `?debug=1&paceLevel=`
  each level in two phone sizes (hit area, strip height, sheet fit, Escape, focus back on the button).
- `e2e/night-look.spec.ts`: Night lighting on the real 3-D view, read from decoded screenshots: a ground region gets brighter from
  Realistic to Brighter to Daylight at night, the sky is pixel for pixel the same and no sun disc appears, by day the looks are one
  picture, no new GPU objects, the choice is remembered, Reset returns to Realistic, and the row is absent on the 2-D map.
- `e2e/picture-quality.spec.ts`: the Picture quality setting. High set in Settings gives a High view on a phone the guess calls Low (with the
  heads-up line), Low gives Low, Auto under Detail asks for High, Auto under Balanced is the guess, and every tier stays inside its
  draw-call and triangle budgets.
- `e2e/icon-tap.spec.ts`: tapping an icon: the Why here? row shows the icon and its name and asks about the icon's own spot; a tap
  60 px away is a plain ground tap; the other tools are unchanged; first on the 2-D map, then on the real engine.
- `e2e/cliffs.spec.ts`: the cliff drawing on the real 3-D view (Katoomba, High and Low): the drawn ground near the escarpment is steeper than
  without the 10 m terrain, edge contrast on the cliff pixels is higher than without the sharpening (a weak, necessary check: a serrated
  drawing passes it, so the pictures matter more), no near-black or all-zero pixel, the same draw calls with and without it and the
  triangles inside the budget; the Data sets Terrain card carries the disclosure and the statistics screen shows its row. It attaches
  the pictures to the report (and writes them to `CLIFFS_SHOTS` when that is set).
- `e2e/air-view.spec.ts`: the air view as the real engines publish it, on both tiers (the tier pinned by the Detail choice or by switching
  the run to the 3-D atmosphere): every picture carries the terrain-following layout, the kind of the air, the datum, the top and the
  air's own time; the fast tier's view holds a 3-D wind of kind `diagnosed` with no temperature or smoke; the wind speed map (now also on
  the fast tier), the wind streaks, the smoke and the curtain work on both, and the curtain's chips and its "diagnosed wind" note follow
  the kind of the air and not the number of levels.
- `e2e/air-tool.spec.ts`: the Air slices tool's placement flow: the Tools entry, "The side view needs the 3-D view." on the 2-D map and no
  chunk loaded, the panel's chunk asked for when the tool opens and not at start-up (and a failed chunk leaves one line, Try again and
  working buttons, and a failed retry says "Close and reopen FireSim to load it" and puts the button away), a real one-finger touch pan
  under the cross, the two-step tap confirm, "Make the line longer than 300 m", what is written to the layers, Swap, a preset, "Me to fire"
  off with its reason, Back and Escape, focus, and nothing popping up by itself. Since 0.5.0: the two tabs (the header fits in one row, at most 50 px, at 412 x 915, 360 x 640 and 844 x 390, and no word of a tab or a chip breaks at 200 % text), the tablist (roles, one tab in the Tab order, Left, Right, Home and End, the polite announcement, no `role=alert`), the Map view as the Layers panel's own controls (one state, both ways), a placement dropped by a tab press, the tab kept, Escape and Back from a chip or the switch, and *Turn off the slice* from the Map view; the 2-D map has no tabs.
- `e2e/airslice-panel.spec.ts`: the side-view panel on both tiers: the painted picture, six chips on the 3-D air and Temp and Smoke off
  with the reason and the button on the fast tier, the probe (tap, drag, arrow keys, Escape, the clear button), "Show model cells", the
  honest footer in view, landscape 844 x 390 (the picture and footer pinned, the chips and controls scrolling, also with a reading on, when
  the chips and Presets can still be reached and tapped), reduced motion (arrows, a picture that holds still) and moving streaks otherwise.
- `e2e/air-slice.spec.ts` (7 tests, 5 of them for 0.4.0): the whole Air slice at once, the tool, the curtain and the panel, on both tiers, for the seams the three
  lane specs above do not reach. A and B placed with the cross after a real touch pan and a tap (the line the scene computed is the one
  placed, and the panel draws it), every preset ("Me to fire" off with its reason), the chips (six on the 3-D air; Temp and Smoke off on
  the fast tier with the scene's reason and the button in view; the panel's chips and the Layers panel's chips are one state, both
  ways), the probe by tap and arrow keys with the pin moving along the line, "Show model cells", the footer and "air from" also with the
  time scrubbed back, landscape, Escape, Back and focus return, the curtain staying when the tool closes, one-finger pan and the pinch
  with the tool open, the button that switches the run to the 3-D atmosphere, reduced motion, high contrast, the dark look, the vertical
  exaggeration, and the 2-D stand-in map drawing the placed line. Since the slice-UI round it also holds the presets to the model's own wind
  at the middle of the line (30 m up, read from the slice's own lattice), the panel redrawn in the next frame and not inside the update that
  made the slice, the Layers compass showing the placed line's bearing and swinging that line about its middle (and clearing the probe),
  and, at 390 x 844 and 360 x 640, that the controls follow the chips and a tap on a chip that is off scrolls to its reason and the button.
  (Since 0.5.0 the recording flow also presses *Turn off the slice*: the button is the last row of the controls with "This also clears the recording." under it, one press clears the stored line, the scene's slice, the recording, the curtain, the marks and the probe, says "Slice turned off. The recording was cleared.", puts focus on *Set start (A)*, leaves the tool open, does not come back when the tool is reopened and lets a new line work; it is not offered while only A is set.)
  The two tests of 0.4.1, one for each tier, run the time-lapse recorder end to end: a preset says it is not recorded and offers *Keep this
  line* (a 4 px gap under *Presets* and the repo's tap-target rule on the tool); keeping it writes A and B, clears the preset, moves focus to the
  status line and announces "Line kept. Recording starts when the simulation next runs."; playing at 120 x fills the recorder (inside its budget)
  and the status says from when to when; scrubbed to three times inside the span the footer says "recorded air from" and how old (the scene's own
  `recordedAt`, newer than the picture's air and at most one gap behind), a time before the first picture does not and says why, the Layers
  panel's two sentences, *Swap* drops the recording and says so, *Clear recording* empties it at once, switching the slice off clears it, and nothing
  pops up by itself. The same spec's tap audit runs at 412 x 915 and 360 x 640.
- `e2e/robustness.spec.ts`: behaviour and robustness on the real engine (switching layers and screens mid-run, flat heap and DOM, determinism, Setup,
  the Android runtime, builds that fail, storage). Since 0.4.1 the determinism test's run B keeps an Air slices preset with *Keep this line* before it
  plays and waits for the recorder to hold pictures (run A has no slice and no recorder), and the fire's hashes must still be equal. "Real engine:
  Settings changed mid-run" gives the engine 30 s to reach 300 s of run time (it needs about 5 to 6 s on a busy machine, over the 5 s default; it
  failed the same way on 0.4.0 under load). Since 0.5.0 the layer cycle needs the *Arrows and flow lines* switch to be usable on the real engine, a block picks each of the six *Wind height* chips with the arrows on and checks the height and that the run goes on, and the random rounds include a height choice.
- `e2e/wind-glyphs.spec.ts` (4 tests, the fast tier, the High picture tier, Katoomba at 6 km, `?debug=1`): a real CDP pinch zoom from 12 km to under 1 km walks the
  ladder (the level never goes down, starts at L1 or L2 and ends at L4, and always agrees with `cellPx` within the planner's 15 %), a one-finger pan keeps the level
  and redraws, three zooms at two heights (the 10 m wind and 300 m) are drawn and kept as screenshots in the report (`WIND_GLYPH_SHOTS=<dir>` also writes them), eye
  level draws nothing and says why, under a 4x CPU slowdown a rebuild stays in slices (slice p95 at most 12 ms, at most 4 slices) while the camera pans and five
  height changes at a close zoom each finish; at the High tier with everything on the layer adds two draw calls, 4 triangles a segment, and the frame stays inside
  550,000 (at the closest zoom, where the picture is the detailed streaks, 550,000 plus the streaks' floor of 2 x `DETAIL_MIN_SEGMENTS`, 24,000); 60 toggles and height changes and 20 zooms leave `renderer.info.memory` and the JS heap where they were; the frame loop stops with the glyphs on; close in
  over the canopy the depth bias shows at least a third more of the strokes than the plain depth test while a ridge still hides what is behind it; and the 2-D
  stand-in map has no glyph statistics. Since 0.6.0 its steps where level 4 differs follow the layer (level 4 draws the detailed streaks).
- `e2e/wind-detail.spec.ts` (2 tests, 0.6.0, the fast tier, the Low picture tier, Katoomba at 6 km, a Pixel 7 profile): the Wind detail chip in the real app. With the default layers the chip is
  shown at 412 x 915, 360 x 640 and 844 x 390: at least 44 x 44 with a 44 px hit area, inside the screen, 8 px above the legend card and clear of every other control; the sheet opens by a
  tap and closes by Escape (focus back on the chip), an outside tap (which does not reach the map) and Close, fits the screen and says the step in plain words, and nothing opens by itself
  while the run plays; with the arrows and flow lines alone a real pinch from 12 km walks the pips with the layer's own level, and the fourth pip needs the detailed streaks drawn; not for the
  Wind speed map, not at eye level unless the Wind streaks are on, hidden while the Layers panel is open, and not in the 2-D map.
- `e2e/wind-detail-render.spec.ts` (2 tests, 0.6.0, the fast tier, the High picture tier, software GL): the detailed streaks in a real renderer. The shader compiles and links with an empty console;
  with only the Wind streaks on a real pinch from 12 km walks the level 1 to 4 and builds nothing below level 4; at the closest zoom the draw calls are at most level 3's and the frame stays
  inside 550,000 triangles (the streaks may take 2 x `DETAIL_MIN_SEGMENTS` more, in a frame that is full without them); through two octaves of zoom in steps of 6 % the number of lines never changes by more than 1.35 times between neighbours; eye level draws none; either switch alone shows them and the old streaks step aside (not the through-the-plume ones); one draw call and two triangles a segment;
  reduced motion gives `detail: 'still'`, no frame in 3 s and two byte-equal shots, and moving gives different shots at different clocks; the hand-over never has an empty frame in either
  direction; 20 round trips leave the GPU objects and the heap where they were.
- `e2e/wind-direction.spec.ts` (11 tests, 0.6.0, the mock engine `?mock=1`, which decides nothing about what the wind then does to the fire; that is the simulation's own tests): the tool is called
  Wind direction and has no map placement; the dial, When, the status lines, Apply (the edit in `session.state.edits`, the list row, the announcement); a change under way and done, and the top bar
  following the wind the session reports; Remove; the At a time field and its three messages; viewing the past; the local wind readings (Setup's belt kit) in their own list, with a Remove that
  works and a turn that leaves them in place, and where they are; a dial left on the wind ("Hold wind from ..."); the forecast's wind-change card, timeline marks and insight cards saying nothing
  about a swing that a change replaces; and the layout at 360 x 640 and 844 x 390 (Apply stays on screen, the list scrolls, every Remove is a 44 px hit area, the dial and the time field are within reach).
- `e2e/gestures.spec.ts` (0.6.0): pins the direction of the two-finger turn (a drag to the right turns the camera anticlockwise seen from above: its compass azimuth goes down), the tilt, the zoom, eye
  level and the mouse, with `cameraRig.gestures.test.ts` (54 tests in node at 0.6.0, 12 more in 0.7.0, the sign of every gesture) as the unit cover. Since 0.7.0 its angle pins are 1.15 times 0.6.0's (the rotation is 15 % faster) and a 100 px upward tilt from the default view meets the 86 degree polar limit.
  `src/render/twoFingerTurn.diff.test.ts` runs the frozen 0.6.0 camera rig (`src/render/testing/cameraRig060.ts`, only its imports and a header differ) and the live one with the same scripted fingers, mouse, modes and flights on a fake clock (43 scenarios and 40 seeded random walks, also on the real Katoomba relief) and compares every frame to 1e-9 rad.
- `e2e/wind-map.spec.ts` and `e2e/wind-felt.spec.ts` (0.7.0, the fast tier, Katoomba at 6 km): *Colour the map by speed* (the chip needs a fire like the Wind speed row and presses the heat map; what the view says it painted, `overlayStats()`, agrees with numbers worked out from the snapshot at What the fire feels, 10 m and the five heights; the legend names the wind and the range, 60 or 90 km/h; one heat map at a time, solo heat, off, remembered; the Layers panel stays under 1,000 DOM nodes and the chips fit at 412 x 915, 360 x 640 and 844 x 390 with 44 px hit areas) and *What the fire feels* (the snapshot carries the picture and the chip draws it, the default for a new profile, a saved 10 m choice kept, the history keeps it with its keyframes, the words on both tiers and the calm-night sentence).
- `e2e/speed-test.spec.ts` (0.7.0): the speed test from Setup, before any run (a worker runs for about 2 seconds, the row holds both numbers and the ratio, the copied text has the row), off while a run plays or computes and on once it is paused and caught up, closing the screen terminates the worker and shows nothing, the app going to the background stops it, no pop-up or alert, a 44 px hit area, and the run's own hashes are the same with and without a test.
- `e2e/wind-motion.spec.ts` (0.7.0, the High picture tier, device scale 1): the idle stop (with the limit set to 3 s, hands off at the closest zoom: no frame in 1.5 s, the clock stands still, `detail: 'paused'`, two frames drawn by hand are byte-equal; a tap, a layer change and a time change wake it; a running simulation never pauses over 10 s; nothing opens by itself), the shader program compiled before the first zoom, reduced motion (the older Wind streaks stay on screen and stand still, the trees stop swaying, the detailed streaks say `still` and never `paused`) and the curtain's arrows thinned where seen edge on at 360 x 640, with the pictures attached.
- `e2e/wind-detail-looks.spec.ts` (0.7.0, the High picture tier): the relief in the forest (the strokes ride on the canopy, no vertex lies inside the disc a placed crown shows at the stroke's height, the colours are the same 64, the pin is 0.05 to 1, the caps and the triangle budget hold), the cold first zoom's layer-side cost (`tickMaxMs` and the slices, logged for the verifier), and the kill switch giving the 0.6.0 builder output.
- `e2e/wind-direction.spec.ts` gained, in 0.7.0, a change of your own raising its own Watch card in the Insights tab, *Back to the forecast* (the button, the sentence, the list, the readings that stay, focus on the dial, the announcement, the forecast's marks and the wind chip back) and a layout check at 360 x 640 and 844 x 390 with two changes and a reading listed; `e2e/air-slice.spec.ts` the F8 pins (the 3-D button within 16 px of the last chip at three sizes, in view without scrolling at 412 x 915, clear of the pinned footer after a scroll at the other two, *Set start* after it) and the 844 x 390 tap audit with a recording (the old 30 px reserve as a control that misses).
- `e2e/air-curtain-gpu.spec.ts` (1 test): the curtain leaks no GPU objects. The section is switched on and off, the line, its length (four
  lengths, so the lattice changes size), the preset and the chip are changed, 60 times, and the renderer holds the same number of
  geometries and textures at the end as after a warm-up (the Layers spec does the same for every other layer).
- `e2e/helpers.ts`, `e2e/fixtures.ts` — shared helpers (menus, speed, timeline, the "no pop-up" watcher, and since 0.5.0 the CDP multi-touch `Hand` that both gesture specs use) and the `test` every spec
  uses, which fails a test on any `console.error`, `console.warn` or page error (`FIRESIM_CONSOLE=report` only prints them).

## Try it on an Android phone

The quickest way is the **debug APK** (about 30 MB, works offline with the nine demo sites; Mount Tomah adds about 3 MB to the 27.6 MB of the first eight):

1. Build it with `scripts/build-android-apk.sh` (installs the Android command-line SDK if needed, no Android Studio
   required), or use a copy someone has built for you. The file is `android/app/build/outputs/apk/debug/app-debug.apk`.
2. Copy it to the phone (download it, or `adb install -r app-debug.apk` over USB with developer mode on).
3. Open it on the phone. Android asks you to allow installing apps from that source (Chrome, Files, Drive…) — allow it
   for this install. Play Protect may warn that the app is from an unknown developer: it is signed with the Android
   *debug* key, so choose *Install anyway* (or *More details → Install anyway*).
4. Launch **FireSim**, accept the training notice, pick a demo site (e.g. Katoomba) and a preset weather, build, then
   mark a fire and press Play. "Use my location" asks for location permission the first time.

To update, install a newer APK over the old one. A debug APK is for testing only; see below for release builds.

## Build the phone apps (Capacitor 8)

The repository is Capacitor-ready (`capacitor.config.ts`, `@capacitor/android` and `@capacitor/ios` installed). The
Android project is committed in `android/` (location permissions and a FireSim launcher icon already added); the iOS
project is not (it needs Xcode on macOS). For Android, `scripts/build-android-apk.sh` builds a debug APK with just the
command-line SDK; for release builds and debugging use Android Studio (and Xcode on macOS for iOS) — see the Capacitor 8
documentation for the exact minimum versions.

```bash
npm run build:cap            # production build without source maps (vite build --mode capacitor)
npx cap sync                 # copy dist/ and the plugins into the native projects (after every build)
npx cap open android         # or: npm run cap:android  (build + sync + open in Android Studio)
npx cap add ios              # once, on macOS: creates ios/
npx cap open ios             # or: npm run cap:ios
```

For iOS, after `cap add ios`, add the location permission the "Use my location" button needs to
`ios/App/App/Info.plist`: `NSLocationWhenInUseUsageDescription` = "FireSim centres the 3-D model on where you are."
(The Android manifest already has `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION`.)

Notes: the app is served from `https://localhost` (Android) / `capacitor://localhost` (iOS); `CapacitorHttp` routes
`fetch` through the native stack, so no service depends on CORS on device (in the browser the NSW, RFS and
Open-Meteo services are called directly and only the canopy bucket is proxied). The simulation runs in an ES-module Web Worker (Android System WebView 108+, which `capacitor.config.ts` enforces, iOS 16+; the build target is ES2022). The bundle
is about 36 MB (about 3.0 MB of app code and styles, 2.8 MB of it JavaScript, from `npm run build:cap`; all JavaScript 963.5 kB gzip, the entry chunk 169.2 kB gzip, the lazy render chunk (with the wind arrows' engine and layer) 224.1 kB gzip, the lazy Air slices chunk 10.3 kB gzip plus 0.9 kB of CSS, against budgets that did not change: 1000 and 195; 0.4.1 was 949.3 and 166.0; at 0.6.0 the integration lane measured about 979.8 kB of all JavaScript and about 172 kB for the entry, and after the detailed streaks' fix lanes the figures were 980.5 kB and 172.7 kB, with the Wind detail sheet a lazy chunk of about 1.27 kB; the release gate's figures are in plan section 21.2; at 0.7.0 two build-only trims (below) took 25.9 kB gzip off all JavaScript, from 992.5 to 966.6 kB at that lane's check with the entry unchanged at 174.3 kB, and on the merged tree with the verifier fixes the check measured the entry at 174.6 kB, all JavaScript 975.4 kB and CSS 131.1 kB raw and 23.9 kB gzip, against the same budgets (195, 1000, 135 and 25); the 0.7.0 gate's figures are in plan section 22.x), of which ~35 MB are the nine demo sites and replays; remove sites from `public/demo/` (and `src/data/demoSites.ts`) for a
smaller app.

**Build-only trims (0.7.0).** `scripts/glslTrim.ts` holds two Vite plugins that run in a build only (`apply: 'build'`: the dev server and vitest keep the real files) and keep every line number, so a shader error or a source map still points at the source; `tests/build/glslTrim.test.ts` fences both. `stubUnusedThreeShaders` leaves out the text of three's built-in materials: `three.module.js` carries all 142 `ShaderChunk`s (about 150 kB of GLSL, 25 kB gzip) because the renderer's table cannot be tree-shaken, and the app draws with `ShaderMaterial` only (a test says it uses no lit material or light). A chunk outside the closure of what the renderer asks for by name, what the app's shaders `#include` and the unlit built-ins (basic, points, sprite, dashed line) becomes a one-line `#error` that names the script, so a shader that still asks for one fails to compile with a message (all JavaScript 992.5 to 975.0 kB gzip, minus 17.5). `minifyGlslTemplates` takes the comments (16 kB of them) and the indentation out of our own shaders, the template literals tagged `/* glsl */`, as three's own build does to its chunks (975.0 to 966.6 kB, minus 8.4); a template with an escape, a nested string or a `${}` inside a comment is left as written. `tsconfig.json` gained `allowImportingTsExtensions` and `noEmit` so that `vite.config.ts` can import the `.ts` helper.

## Offline use and area packs

Mountain firegrounds often have no signal. FireSim works fully offline for the demo sites (terrain, canopy,
imagery, vegetation, fire history, roads, homes and place names), the presets, the historic replays, the belt weather kit and manual weather.
Elsewhere, **save an area pack** before you go: Setup → Run → *Save this area for offline use* (with the network
on) downloads the 10 m terrain, canopy, SVTM vegetation, NPWS fire history, roads, homes and place names, the latest
forecast and a year of daily rain for the chosen square into the device's IndexedDB (`src/scenario/areaPack.ts`, `src/data/cache.ts`). With
*Use the network* off, the builder uses bundled data, then area packs, then the cache, then inference and
synthetic fallbacks — each fallback is listed as a warning on the build screen and in Stats → Data used.

## Roads, homes and place names

So that you can find yourself on the map, every scenario can carry five *places* layers, all official NSW open data
(CC BY 4.0, cross-origin enabled, queried with plain ArcGIS REST `query` requests):

| Layer | What it is | Source service (`portal.spatial.nsw.gov.au/server/rest/services/…` unless stated) |
|---|---|---|
| Roads and tracks | every open road, track and path, with its class (motorway … local, service, track, path), surface (sealed, unsealed, 4WD only) and name; tunnels left out | `NSW_Transport_Theme/FeatureServer/5` (RoadSegment) |
| Fire trails | vehicle tracks classified by the NSW RFS for firefighting access | `NSW_Transport_Theme/FeatureServer/9` (ClassifiedFireTrail) |
| Homes | one point per dwelling address (units in one building share a point) | `NSW_Geocoded_Addressing_Theme/FeatureServer/1` (AddressPoint) |
| Residential and built-up zones | land-use zones R1–R5 (residential), RU5 (village), C4 (environmental living), RU4 and RU6 (small rural lots), B*, E1, E2, MU1 (commercial), IN*, E3–E5 (industrial), SP3 (tourist) | `mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/19` |
| Place names | towns, villages and localities (points) and suburb names (labelled at the centre of the suburb, only where the label will be seen) | `NSW_Features_of_Interest_Category/FeatureServer/1` (PlacePoint) and `NSW_Administrative_Boundaries_Theme/FeatureServer/2` (Suburb) |

Attribution: © Spatial Services NSW; © State of NSW and Department of Planning, Housing and Infrastructure (both
CC BY 4.0). The strings travel with the data (`ContextLayers.sources`) and are listed in Settings → About.

**Where the data come from, in order** (`src/scenario/context.ts`, `loadContext`):

1. **Demo sites: bundled, works offline.** `public/demo/<site>/context.json` holds the layers for each demo site's
   9 km square plus a 400 m margin, delta-coded to about 1 m and 13-280 KB per site. Loading takes a few
   milliseconds. Re-create the files with `NODE_USE_ENV_PROXY=1 node scripts/fetch-demo-context.mjs [--out=dir] [siteId ...]`
   (needs Node 22.18 or newer; the script imports the app's own classification code, so the two cannot drift apart).
2. **An area pack** that covers the area (item `context`, saved with the pack in Setup while you have signal).
3. **The cache**, when the entry is at most 7 days old. The key is the query envelope rounded outward to about 500 m,
   so a slightly different centre reuses the entry; the 10 most recent entries are kept.
4. **A live query** of the six services (`src/data/nswContext.ts`, `fetchNswContext`) when the network is on: the
   domain plus 400 m, object-id chunked POSTs, concurrent per layer, retried with back-off (including HTTP 429), and
   cancelled with the build. It runs **in parallel** with the rest of the build; after 45 s it stops waiting and keeps
   the layers that have arrived (the zoning server is the slow one: 10-20 s for a 6 km area), naming what is missing
   in a warning. A complete result is cached. On a device the requests go through CapacitorHttp; in a browser they are direct (the services
   send CORS headers).
5. **An older cache entry**, or the part of a neighbouring demo site that overlaps the area, each with a warning.
6. **Nothing**, with the warning *"Roads and homes are not available offline for this place — save an area pack in
   Setup while you have signal"*.

This step never fails a build: every problem becomes a warning on the build screen and in the scenario's warnings
(a layer the services would not answer for is reported by name and left empty). In the **Setup** screen, *Save this
area for offline use* now stores the roads, homes and place names with the terrain and the weather.

Tests replay real ArcGIS responses recorded for a 2 km box in Blackheath (`tests/fixtures/nsw-context/`, re-recorded
with `record.sh`) through a fake server, so no test needs the network. `NET=1 NODE_USE_ENV_PROXY=1 npx vitest run
src/scenario/context.live.test.ts` runs the one real check against the live services (Bilpin, outside the demo sites).

## Performance

Measured in headless Chromium on one 2.1 GHz Xeon core (x86), Katoomba 6 km at 30 m (200 × 200 fire cells), the
extreme "hot NW wind" preset with the fire on the escarpment, 4 simulated hours (a ~2 000 ha fire):

| | fast tier (surface wind) | standard tier (3-D atmosphere 45 × 45 × 20) |
|---|---|---|
| worker throughput | **≈ 900 simulated s per wall s** (4 h in 16 s) | **≈ 220 s/s** (4 h in 66 s) |
| scenario → first snapshot | 1.2 s (moisture spin-up) | 1.1 s, then 3-D spin-up ≈ 3 s |
| first result after Play | 0.3 s | 0.3 s once spun up (the spin-up runs while you mark the fire) |
| snapshot size (transferred) | 1.8 MB | 2.6 MB |

Inside the app (with the 3-D view rendering in software GL on the same CPU) the fast tier runs at 600–900 s/s. On
the main thread no task over 50 ms was observed while playing at maximum speed; updating the 3-D view from a
snapshot takes 4 ms median, 9 ms p95. All of that is one desktop core. Only one phone has been measured so far: on it
the 3-D step took 41 ms (the mean of the first 20 steps, warm-up included), so the app does not claim a speed for phones in
general. A phone's own numbers are on the *Simulation debug statistics* screen (its *What this phone can do* group turns them
into three measured sentences), and the timeline says when the simulation cannot keep up with the speed you chose (*Speed: what
the app measures and what it says*, above).

Tiers: *Settings → Performance*: **Balanced** (the default) is **Auto**: it times 30 steps of the 3-D spin-up, skips the first 10
and keeps the detailed 3-D air unless the median of the other 20 predicts a whole run longer than 10 minutes of computing for 6
hours of fire (about 198 ms per air step; spec §12.6 as changed in 0.3.0), else it picks the fast tier; **Saver** = fast;
**Detail** = high (3-D, 24 levels). A fast-tier run can be switched to the 3-D atmosphere from the Layers panel or the Air slices
panel (for the plume, temperature and smoke): the worker restores the last checkpoint and re-runs. The 3-D view adapts its
resolution to the frame rate and draws only when something changes; snapshots stream every 5 simulated minutes into a
memory-capped replay store (≈ 6 % of the device memory, 48–160 MB).

## Design system

The UI uses a flat, Google-Maps-for-Android-style design language (white cards on light grey, one blue accent, fire colours reserved for
fire and danger, slightly tighter spacing than stock Android) with a night theme and a high-contrast "bright sun" variant.
[`docs/DESIGN.md`](docs/DESIGN.md) documents the tokens, every primitive with its markup, the 44 px tap rule, the high-contrast variant and where
each screen's rules live. The audits are `npm run check:contrast` (every stylesheet, four looks) and `scripts/audit-tap-targets.mjs`,
`scripts/audit-contrast-dom.mjs` and `scripts/layout-budget.mjs` against a running build.
During development open `/src/ui/styleguide.html?theme=light|dark&contrast=high` on the dev server for the live gallery
(screenshots in `docs/screenshots/design/`).

## Architecture

TypeScript + Vite web app in a Capacitor shell; Three.js (WebGL2) for the 3-D view; all numerical code is plain
TypeScript on typed arrays, running in a Web Worker and unit-tested in Node. Details, contracts and the coupling
loop: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```
 Setup ─► scenario/buildScenario ─► data/ (bundled · area pack · cache · network) ─► terrain/ + fuel/ ─► ScenarioData
                                                                                                          │ init
  UI (ui/session) ◄── snapshots, insights, explanations ── SimClient ◄──postMessage──► sim/worker ◄───────┘
   │  └► render/SceneView (terrain, trees, flames, smoke, embers, wind, overlays, cross-section)
   └─ ignitions · fuel/wind edits · what-if · rewind ──► sim/Simulation: moisture → atmosphere → fire → embers → explain
```

| Module | What it does |
|---|---|
| `src/core` | shared types and contracts (`types.ts`, `simTypes.ts`), grids, local projection, units, seeded RNG, shared physics, `airView.ts` (what an air view is and holds), `airPack.ts` (the 16-bit copy of a fast-tier wind volume that the history keeps), `sliceRecording.ts` (the packing, the byte model and the budget of the Air slice recorder), `fireWind.ts` (0.7.0: the helpers of the 60 m wind the fire feels: blocks, grid, bytes, decode) |
| `src/data` | bundled assets, HTTP (native / dev proxy), IndexedDB cache and area packs, terrain tiles, canopy, demo rasters and sites |
| `src/terrain` | slope, aspect, curvature, TPI, landforms, solar position, insolation with terrain shadows, hillshade |
| `src/fuel` | fuel catalogue, SVTM mapping, vegetation inference, fire history and accumulation, fuel map and edits |
| `src/fuel/moisture` | dead fine fuel moisture per cell, stable nights and cold pools, KBDI / Drought Factor, availability, ignition probability |
| `src/fire/models` | Vesta Mk2 / 2012, CSIRO grassland, heath, pine, McArthur, intensity, flame height, spotting, AFDRS FBI |
| `src/fire/terrainFeatures.ts` | gullies / chimneys, ridges, saddles, lee slopes for the mountain phenomena |
| `src/fire/spread` | level-set spread with directional slope, mountain phenomena, spread-driver attribution, checkpoints |
| `src/atmosphere` | mass-consistent background wind, 3-D terrain-following Boussinesq solver, slope flows, fire heat, fast `DiagnosticWind` (which also publishes its fitted wind as the diagnosed 3-D wind) |
| `src/embers` | Lagrangian firebrands: emission, lofting, transport, burnout, landing and spot-fire ignition |
| `src/explain` | insight detectors and card texts, forecast cards, "Why here?" cell explanation |
| `src/scenario` | the build pipeline, weather sources (Open-Meteo), presets, replays, belt kit, area packs, live feeds; `windDirection.ts` (0.6.0: the Wind direction change as a transform of the forecast, pure, light imports; 0.7.0: `windRerunFrom`, `userWindChanges`) |
| `src/sim` | `Simulation` (coupling loop, records, checkpoints, rewind, tiers), `SimHost`, worker, `SimClient`; `fireWindPublish.ts` (0.7.0: the 60 m wind the fire feels, Int16, in every snapshot) |
| `src/render` | `SceneView`: terrain, vegetation, flames, embers, smoke, wind particles, overlays, the air slice's curtain, camera rig; the air sampler (`atmosphereSampler.ts`); 0.7.0: `idleStop.ts` (the idle clock), `twoFingerTurn.ts` (the two-finger turn, public OrbitControls API only), `curtainArrows.ts` (which columns of the curtain's arrows are drawn), `plumeSite.ts` (the fire's plume as an eddy site) |
| `src/render/wind` | the wind arrows and flow lines (0.5.0): the pure engine (`glyphLod` the level and the visible ground, `glyphPose` and `glyphSchedule` when to rebuild and how much room there is, `glyphField` the wind raster, `flowGlyphs` the builder), `windGlyphLayer` (the Three.js side: two `StreakBatch`es, staged rebuilds, the self-trim); the engine has no Three.js and no DOM. 0.6.0: `detailStreaks` (the pure builder of the detailed streaks) and `detailBatch` (their one-draw-call batch and shader), both driven by `windGlyphLayer`. 0.7.0: `detailObstacles` (the canopy, the tree crowns and the eddies the detailed streaks flow round), `windMapField` (the Wind speed map at a Wind height) |
| `src/render/slice` | the Air slice's pure modules: `sampleSlice`, the line and its presets (`sectionFromEndpoints`, `resolveSlice`, `presetWindFromDeg` for the wind the presets follow), axis ticks, flow streaks, the probe, the shared `SliceUpdater`, and the time-lapse recorder (`sliceRecorder.ts`, the scene's half `sliceTimeLapse.ts`); no Three.js and no DOM |
| `src/ui` | app shell, setup / building / simulation screens, session (time, playback, edits; `cutHistory`, the one place the history and the slice recorder are cut), panels, mocks, `recordingWords.ts` (the words of the recording); 0.7.0: `speedTest*.ts` (the speed test, imported only by the statistics screen) |

## Known limitations

- The models are simplified and calibrated for education; many mountain-effect coefficients are hypotheses flagged
  [H]/UNVERIFIED in the spec (§16). Real fires on steep slopes and in extreme weather are often faster.
- Speed on a phone is measured by the app, not assumed: only one phone has been measured so far (its 3-D step took 41 ms). Auto
  keeps the detailed 3-D air unless a whole run is predicted to take more than about 10 minutes of computing for 6 hours of fire,
  so at a high playback speed, or with a big fire, the simulation can fall behind; the timeline then shows its speed button and
  the sheet says what is happening. The fast tier is about 4× quicker (900 against 220 s/s on the desktop core
  above) but has no plume, cold-air pools, temperature or smoke in an air slice, which need the 3-D atmosphere (Balanced on a phone
  that can run it, Detail, or one tap in Layers or Air slices); an air slice on the fast tier shows the diagnosed wind and says so.
- Validation (`src/sim/validation/`): the spec's §15 scenarios pass, including gully-vs-sunny-slope litter moisture
  (V8), lateral spread rate on lee slopes (V10), the fire-induced-wind card (V15) and coupled head ROS in both tiers
  (V22). Remaining gaps: the V20 speed gates are missed for very large (≈ 3 000–5 000 ha) fires, the standard tier
  reproduces the forecast 10 m wind on flat ground to ≈ 1 % on average but up to ≈ 4 % in single cells (V21), and one
  long forecast-fixture scenario is still an expected failure.
- A Google **short link** can be opened only in the Android app (one request to Google); in a browser paste the long address. A place
  Google gives only a place id (no position in the address) cannot be used: touch and hold the spot in Google Maps to drop a pin and share that.
  Pasting the clipboard with the link button needs the phone's permission; if it is refused, touch and hold the box and choose Paste.
- Weather and live data need the network (or an area pack). On device, requests go through CapacitorHttp; in the
  browser (including an installed PWA) the NSW, RFS and Open-Meteo services are called directly — all send CORS headers
  (verified live, doc 08b). Only the remote canopy-height bucket needs the dev-server proxy (or a deployment proxy).
- Snapshots are dense (≈ 2 MB each); long runs are thinned in the replay store to fit its memory budget. Since 0.7.0 every snapshot and every keyframe also carries the 60 m wind the fire feels (10 kB at 3 km, 40 kB at 6 km, 160 kB at 12 km: 4.6 % of a kept keyframe at 6 km). Since 0.4.0 the fast tier's
  snapshots also carry its diagnosed 3-D wind (about 0.5 MB more per snapshot, 474.6 KiB at 45 x 45 x 20; the whole snapshot size was not
  measured again). The newest snapshot holds it exactly; the history keeps an older picture's copy packed to 16-bit integers (237.3 KiB,
  within 0.00046 m/s at 30 m/s) in a list with 4 % of its memory, so the pictures kept over a 6 hour run are about those of 0.3.0 (the
  count about 5 % lower on average over the last hour, the longest gap at the 6 hour instant the same or shorter) and what thins instead is the freshness of
  the air in old pictures: on a 0.5 or 1 GB phone it can be hours older than the picture, and the slice footer says so.
- Air slices (0.4.0, see *Air slices and the air picture*): seen only in software rendering and in node tests, never on a phone, so the
  streaks' frame rate, the panel's feel with gloves and the chunk's load time on a phone are open. On the fast tier the slice shows the
  forecast wind fitted to the terrain, not the wind the fire feels, and it says so in the footer; on a calm night the 10 m wind that both
  tiers publish, which the slice and the wind speed map show, can differ a lot from the wind the fire feels; Temp is relative to the slice's
  own air at each height, so on a short line through a plume it understates the plume.
- The Air slice recorder (0.4.1, see *Recording a line*): seen only in software rendering and in node tests, never on a phone. A line placed while
  the run plays is recorded only from where the simulation had computed to, which can be well after the time shown, and nothing is filled in
  backwards; its cost at Max speed is a main-thread load in the first minute after *Keep this line* (a 4x-throttled browser measured a 95th
  percentile of 11 to 13 ms for one picture, and a single one can exceed a frame); it comes on top of the history (6 to 12 MiB); the
  statistics row counts live samples only; in short landscape the footer is hidden while a probe reading is shown, so nothing in view says "recorded"
  then; *Clear recording* cannot be undone.
- The wind arrows and flow lines (0.5.0, see *Wind arrows and flow lines*): seen only in software rendering and in node, never on a phone, so the ladder's edges (4,
  12, 32 and 90 px a model cell) while pinching, the halo's legibility in sunlight, 2.5 px strokes at a pixel ratio of 3, rebuild hitching while panning, the battery
  and TalkBack on the tabs, the chips and *Turn off the slice* are open. The marks are a smooth fit through a model whose cells are 100 to 270 m wide, not new detail;
  a stronger wind than about 8 to 14 m/s is told by colour and not by length; in an orbit view at a tilt of 68 to 82 degrees the L3 rows stack about 10 to 13 px apart
  near the horizon and convergent flow makes bundles (not fixed); the map legend card still shows at level 0; the arrows and the animated streaks can clutter when both
  are on. The 10 m chip is the model's wind over open ground, which on a calm night is not what the fire feels (0.7.0 added "What the fire feels" and colouring the map by
  speed: see its bullet below). *Turn off the slice* clears the recording without asking (the hint is the safeguard) and cannot be undone. (Two 0.5.0 findings are fixed in 0.7.0: on the
  fast tier the *Use the 3-D atmosphere* button was one row lower than in 0.4.1 and never in view unscrolled, and at 844 x 390 with a recording the real-engine tap audit
  missed 3 of 8 bottom probes of every control below the picture; the cause of the second was the pinned footer, not the compass button.)
- The 0.6.0 wind changes (see *Wind detail and the detailed streaks* and *Wind direction*): seen only in software rendering and in node, never on a phone. The detailed
  streaks' look (stroke width, eddy amplitude, density, the speed the pulses move at), their cost and battery use on a phone, and the chip's place on a small screen are first guesses;
  the eddies are added for looks and are not the model's. Wind direction: the extra background solves of a turn cost about 2.2 to 2.6 s over a 60-minute standard-tier run on the build machine (phone
  unmeasured; the fallback is to raise `WIND_TURN_STEP_DEG` from 15 to 20, which no measurement has asked for); on the 3-D settings the wind near the ground can lag the turn by up to about 15 degrees and settle
  within minutes; Katoomba or the High tier with a fire present was not measured for the lag; the forecast's S13 and foehn cards still read the forecast direction. The side view's denser streaks
  and arrows were judged in software rendering only. (0.7.0 closed four 0.6.0 items: the cards, the zone and *Back to the forecast* for a change of your own, the Danger-gate gap, the old Wind streaks and reduced motion, and the two-finger turn's
  dependence on two private members of three's `OrbitControls`; the last is now `twoFingerTurn.ts`, public API only, with `lostpointercapture` kept as a safety net that three tests pin.)
- **0.7.0** (see *The wind the fire feels and Colour the map by speed*, *Wind detail and the detailed streaks*, *Wind direction*, *Controls* and the speed test under *Simulation debug statistics*; plan 22.4 has the full list): seen only in software rendering and in node, never on a phone, and phone check-lists 1 to 4 are still outstanding.
  **Not built: H-sim** (rock in the fire model), blocked on an expert re-label of 80 aerial tiles (decision D17, spike S6). Not measured: the battery effect of the idle stop; the publisher of the 60 m picture, the speed test and the relief's cost on a phone; the look of the 60 m picture on the 3-D tiers and
  the High picture tier. The Layers panel is at 999 of its 1,000 DOM nodes with the arrows on (the e2e asserts the limit: the next row there must build lazily). At the High picture tier the detailed streaks still go over the frame's triangle limit by design. **The pan:** far ground near the horizon moves the view fast (25 m a pixel at 5 degrees below it,
  against 1.4 m in the middle, for the check's camera), a flick on far ground glides far (up to about 3.5 km in the verifier's harness at the first margin, against 457 m in 0.6.0; not re-measured), and a one-finger pan that moved the view 0 m once was not reproduced (most likely a touch that landed on the legend's title).
  **Layout:** at 390 x 844 on the fast tier every control of the Air slices tool but *Presets* is in view without scrolling, and *Presets* is about 38 px under the pinned footer at the top scroll (the orchestrator's figure); after a long session the tool's sheet is 76 px shorter than in a fresh one and the cause was not found. **Words:** the demo engine's forecast wind change card still says compass letters ("from W to S") where the real card says the words. **Tests:** the recording-flow e2e is flaky under load.
  The detailed streaks in dense forest: see plan 22.4 (the relief's canopy plane and crown cap were a verifier's findings, handed to a last fix lane).
- Places data are what the NSW services hold: a track that is not mapped is not drawn, a home without an address point is not
  counted, and the zoning layer is the planning map, not what is built. The 3-D trees are decorative (placed from canopy cover and
  height); the fire and the air do not see individual trees.
- Download sizes on a phone: CapacitorHttp does not report the compressed size of an answer, so a download is shown as "up to ..."
  (its uncompressed size); estimates before a download (≈) are uncompressed upper bounds. Bundled and stored sizes are exact.
- Verified in Chromium (Pixel 7 and other phone sizes, SwiftShader WebGL) and under an emulated Capacitor runtime; the Android Back
  button handling (`MainActivity.java`), Android's 200 % font scale and the high-contrast look have not been checked on a physical
  phone. The 200 % font scale is emulated by doubling the type tokens, which is what the WebView's text zoom does to CSS pixels;
  at 400 % the Setup screen no longer fits.
- Cliffs are a drawing in 0.3.0 (see *Cliffs: what is drawn and what is simulated*): the fire model still treats ground it calls Cliff
  (a slope over 45 degrees on its 20 or 30 m cells, or many steep 10 m sub-cells) as a wall the surface fire cannot enter, whether it is
  bare rock or forested, and does not read the drawing; rock in the fire model is planned for 0.3.1. A face under about 60 m high still
  reads as a steep bank. The drawing was judged on still frames in software GL, by one reviewer, and its timings were measured in node and
  in Chromium on a desktop, never on a phone, so how long it takes on a phone and how its detail looks there are open.
- Before the first Play of a run, the model card and the statistics can still say that Auto is timing the phone: the first picture is
  sent before the 3-D spin-up that does the timing, so the tier line catches up with the first snapshot after Play. The decision itself
  is not affected.
- Picture quality: the screenshots are taken in software GL, with DejaVu / Liberation Sans standing in for Roboto (no 500 weight).
- `docs/screenshots/` are regenerated by `npx playwright test` (the numbered pictures) and `node scripts/app-screenshots.mjs` against
  a dev server (`docs/screenshots/design/`).

## Licence

Code: MIT (see `package.json`). Bundled data keep their own licences (table above; CC BY 4.0 requires attribution,
which the app shows in Settings → About).
