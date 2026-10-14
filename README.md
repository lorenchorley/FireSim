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
| Vertical cross-section (3-D atmosphere) | Insight cards | "Why here?" explanation | Eye level from a lookout |
| ![Menus](docs/screenshots/09-menus-open.png) | ![Timeline jump](docs/screenshots/10-timeline-jump.png) | ![Speed](docs/screenshots/11-speed-popover.png) | |
| The two round menus, expanded (tools, view) | A jump far ahead computing, with Cancel | Playback speed options | |

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
  fast surface-wind tier (the Saver profile, or when Auto finds that the 3-D air would take far too long on the phone), and Lagrangian embers with
  spot-fire ignition. The app says when the simulation cannot keep up with the speed you chose (see *Speed and the
  timeline signal*); the result never depends on speed.
- **Explanations**: insight cards as the fire does something worth learning (upslope run, ridge-crest slowdown,
  gully chimney, lee-slope eddy / VLS, spotting, crown fire, wind change: "the flank becomes the head", dead man zone,
  pyroconvection…), repeats grouped per phenomenon, "Show me" switches on the layer that makes it visible.
  **Why here?** — tap anywhere for the factor breakdown (wind, slope, moisture, fuel, terrain, position on the fire)
  and a narrative. Tap an **icon** (the fire you marked, a spot fire, an insight marker, your own position, a home) and the
  panel opens with that icon as the map draws it and its name in a word or two (for example "Spot fire" or "Danger: Uphill
  run"), and the question is about the icon's own spot; tap the ground and there is no icon row.
- **Views**: 3-D orbit, top view, eye level ("what you would see from here"), wind particles (surface or through the plume),
  vertical cross-section, vertical exaggeration, compass and zoom buttons for gloved hands. One finger slides the map, two fingers
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
  flames, smoke, embers, wind streaks, insight markers; and *Heat maps*, every data layer as a colour map of the ground (cool = little,
  warm = much), one at a time, optionally **on its own** (the photo and the trees step aside): ground height, landform, slope, aspect,
  sunlight, tree height and cover, shrub height, the four fuel hazards (leaf litter, grass and low shrubs, shrubs, bark), grass curing,
  fuel type and load, years since fire, wildfire or prescribed burn, homes per hectare, distance to a road, wind speed, litter moisture
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
  features) and the recent events. A Copy button puts the whole page on the clipboard as plain text, so a phone's readout can be
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
| **One finger drag** | slides the map like grabbing it: the ground under the finger stays under it, at any tilt (a light glide carries on when you flick and let go; touching the map stops it) |
| **Two fingers moving together** | turns the view (sideways drag) and tilts it (up or down); the top view can only turn |
| **Pinch** | zooms towards the point between the fingers |
| Pinch **and** drag in one movement | zooms and turns / tilts at the same time (no mode to pick) |
| Lift one finger of two | carries on as a one-finger slide from where the other finger is; a second finger put down during a slide switches to turn / zoom, without a jump; a third finger is ignored |
| **Tap** | "Why here?" (or places the fire / fuel brush when that tool is open); a slide is never a tap |
| **Tap an icon** (with the Why here? tool) | opens the panel with that icon and its name at the top, and asks about the icon's own spot: the ring jumps onto it. A tap within about 22 px of an icon's centre counts (a home: 14 px); the nearest icon wins, and a stack says "+2 more icons here, zoom in to tell them apart". Tap the ground beside it and there is no icon row. The other tools (fire, fuel, wind) still place on the ground under the finger |
| **Eye level** ("what you would see from here") | a first-person look-around: one or two fingers turn the view; you cannot slide your position, there is no zoom |
| Drawing a fire line or painting fuel (**Draw a line** in Fire, **Paint** in Fuel) | one finger draws and the map is locked; switch back to tapping to move the map again |
| Mouse (desktop development) | left button slides, right button turns and tilts, middle button or wheel zooms |
| Round buttons (View menu) | zoom in / out, the 3-D, top and eye-level views, fly to the fire or to you, turn the map north up. Turning and tilting by hand have no button (two fingers; right mouse button), nor has sliding (one finger; left mouse button) |

Sensitivity: a pinch is 1 : 1 (fingers twice as far apart = half the distance) and two fingers dragged one and a half screen heights
turn the view a full circle. At a flat viewing angle the ground near the horizon covers kilometres per pixel, so the map is not
held one-to-one there: a drag that starts in that part of the screen slides the view at most five times as fast as one in the
middle. Lifting the finger never moves the picture: the camera does not climb or sink with the terrain, the view's pivot (the
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
| **Atmosphere** | standard / high tiers: **3-D** Boussinesq flow on a terrain-following grid; **fast tier: a 2-D surface wind** fitted to the terrain (mass-consistent), no time-stepped air flow | 45 × 45 × 20 columns about 133 m apart (standard, 6 km), 60 × 60 × 24 (high); the fast tier fits the wind on the standard grid | 3 s to 12 s (shorter in strong wind); fast tier 10 s |
| Fire and air feedback | two-way in 3-D; a 2-D indraft estimate in the fast tier | the air grid / the fire grid coarsened ×2 | every step |
| Embers | **3-D** Lagrangian particles (up to the performance profile's maximum) | individual tracked particles in 5 bark and fuel classes | every outer step |
| Smoke | 3-D tracer in the 3-D tiers; only a drawn column in the fast tier | the air grid | every air step |
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
sets screen's working memory: for a 9 km area (810,000 cells of 10 m) 0.81 MB on the screen thread (the rock copy) and 7.1 MB on the
graphics side (the lighting gradient 3.2 MB, the rock mask 3.2 MB and the mesh's slope 0.64 MB at High), plus about 13 MB held while
the scenario is set up and then released. The render chunk grew by about 7.5 kB gzipped (+19 kB raw) and the entry by about 0.4 kB.

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
npm test                          # Vitest: every module, about 2 200 tests incl. the §15 validation scenarios
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
- `e2e/layers.spec.ts` — the Layers panel against the catalogue, heat maps, solo and plain ground, remembered choices, no GPU leaks.
- `e2e/datasets.spec.ts`, `e2e/model-card.spec.ts` — the two information screens: their numbers equal `window.__firesim`'s.
- `e2e/integration.spec.ts` — the seams: every entry point to Data sets and the model card, the Back order, focus returning, the stage
  inert behind a screen, the reviewers' follow-ups (the weather chip is not a button, Tab never leaves Settings for the map, Play has
  no aria-pressed, backgrounding cancels a fast-forward), high contrast, the 200 % font scale at three phone sizes, deletions that ask
  first, and a whole run in which every screen is visited and nothing pops up or pauses it.
- `e2e/truth.spec.ts` — the truth audit of the two information screens on the real engine: the tier the Data sets screen names is the
  engine's (whatever the auto-tune picked), its memory is sized for that tier, the places figures are for the model area, a designed weather
  is never "real data", and the card's layer list agrees with the tier about the smoke and the wind.
- `e2e/gallery.spec.ts` — takes the pictures of the new screens for `docs/screenshots/` (see above).
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
- `e2e/helpers.ts`, `e2e/fixtures.ts` — shared helpers (menus, speed, timeline, the "no pop-up" watcher) and the `test` every spec
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
is ~38 MB (about 2.9 MB of app code and styles, 2.8 MB of it JavaScript, from `npm run build:cap`), of which ~35 MB are the nine demo sites and replays; remove sites from `public/demo/` (and `src/data/demoSites.ts`) for a
smaller app.

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
**Detail** = high (3-D, 24 levels). A fast-tier run can be switched to the 3-D atmosphere from the Layers panel
(cross-section / "through the plume") — the worker restores the last checkpoint and re-runs. The 3-D view adapts its
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
| `src/core` | shared types and contracts (`types.ts`, `simTypes.ts`), grids, local projection, units, seeded RNG, shared physics |
| `src/data` | bundled assets, HTTP (native / dev proxy), IndexedDB cache and area packs, terrain tiles, canopy, demo rasters and sites |
| `src/terrain` | slope, aspect, curvature, TPI, landforms, solar position, insolation with terrain shadows, hillshade |
| `src/fuel` | fuel catalogue, SVTM mapping, vegetation inference, fire history and accumulation, fuel map and edits |
| `src/fuel/moisture` | dead fine fuel moisture per cell, stable nights and cold pools, KBDI / Drought Factor, availability, ignition probability |
| `src/fire/models` | Vesta Mk2 / 2012, CSIRO grassland, heath, pine, McArthur, intensity, flame height, spotting, AFDRS FBI |
| `src/fire/terrainFeatures.ts` | gullies / chimneys, ridges, saddles, lee slopes for the mountain phenomena |
| `src/fire/spread` | level-set spread with directional slope, mountain phenomena, spread-driver attribution, checkpoints |
| `src/atmosphere` | mass-consistent background wind, 3-D terrain-following Boussinesq solver, slope flows, fire heat, fast `DiagnosticWind` |
| `src/embers` | Lagrangian firebrands: emission, lofting, transport, burnout, landing and spot-fire ignition |
| `src/explain` | insight detectors and card texts, forecast cards, "Why here?" cell explanation |
| `src/scenario` | the build pipeline, weather sources (Open-Meteo), presets, replays, belt kit, area packs, live feeds |
| `src/sim` | `Simulation` (coupling loop, records, checkpoints, rewind, tiers), `SimHost`, worker, `SimClient` |
| `src/render` | `SceneView`: terrain, vegetation, flames, embers, smoke, wind particles, overlays, cross-section, camera rig |
| `src/ui` | app shell, setup / building / simulation screens, session (time, playback, edits), panels, mocks |

## Known limitations

- The models are simplified and calibrated for education; many mountain-effect coefficients are hypotheses flagged
  [H]/UNVERIFIED in the spec (§16). Real fires on steep slopes and in extreme weather are often faster.
- Speed on a phone is measured by the app, not assumed: only one phone has been measured so far (its 3-D step took 41 ms). Auto
  keeps the detailed 3-D air unless a whole run is predicted to take more than about 10 minutes of computing for 6 hours of fire,
  so at a high playback speed, or with a big fire, the simulation can fall behind; the timeline then shows its speed button and
  the sheet says what is happening. The fast surface-wind tier is about 4× quicker (900 against 220 s/s on the desktop core
  above) but has no plume, cold-air pools or cross-section, which need the 3-D atmosphere (Balanced on a phone that can run it,
  Detail, or one tap in Layers).
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
- Snapshots are dense (≈ 2 MB each); long runs are thinned in the replay store to fit its memory budget.
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
