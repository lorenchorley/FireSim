# 08 — Data Sources and APIs for NSW (weather, terrain, imagery, fuel, fire history, incidents)

FireSim research series, document 08. This document covers where FireSim gets its data for a point in the NSW ranges, how each service is called, what comes back, whether a phone can call it (CORS, rate limits, keys), whether we may cache it offline (licence), and how to package it into offline **area packs** for fire grounds without mobile coverage. The worked example is a point near Katoomba, **(−33.71, 150.31)**, in the upper Blue Mountains.

Date of research: **2026‑09‑27**.

---

## 0. Provenance and verification tags (read first)

**Research environment.** The sandbox's egress proxy **blocked** these hosts: `api.open-meteo.com`, `open-meteo.com`, `www.bom.gov.au`, `reg.bom.gov.au`, `api.weather.bom.gov.au`, `www.rfs.nsw.gov.au`, `maps.six.nsw.gov.au`, `portal.spatial.nsw.gov.au`, `mapprod3.environment.nsw.gov.au`, `hotspots.dea.ga.gov.au`, `firms.modaps.eosdis.nasa.gov`, `elevation.fsdf.org.au`, `server.arcgisonline.com`, `api.mapbox.com`, `tiles.mapterhorn.com`, `share.phys.ethz.ch` and `data.tern.org.au`. The session's web-search budget was already used up when this task started.

These hosts **were** reachable: AWS S3 (`elevation-tiles-prod`, `dataforgood-fb-data`, `esa-worldcover`, `dea-public-data`, `copernicus-dem-30m`, `elevation-direct-downloads`), `raw.githubusercontent.com`, and GitHub code search.

So I did three things:

1. I **ran live requests** against every S3-hosted dataset and decoded the actual bytes: tiles, COG headers, pixel values at Katoomba, and CORS headers with an `Origin:` header and pre-flight.
2. I read the **provider's own documentation source**. The Open-Meteo website and server are open source on GitHub, so I read the docs pages, the pricing and terms pages, and the Swift code that does CORS and elevation downscaling.
3. I read **recent third-party client code** (2024–2026) for the services I could not reach, and cited the repository and date.

| Tag | Meaning |
|---|---|
| **[V]** | Verified **live** this session: a request from the sandbox and inspection of the real response bytes or headers. |
| **[S]** | Verified from the provider's own documentation or source code, via its GitHub mirror. |
| **[3P]** | Reported by third-party code or docs, with repo and date given. The endpoint pattern is very likely right, but check it on device. |
| **[K]** | Domain knowledge I could not re-verify this session. Check it before hard-coding. |
| **[H]** | A FireSim design choice or heuristic. It is not a property of the data source. |

**Adversarial fact-check pass (2026‑09‑27, second reviewer).** Every endpoint, formula and number was re-checked against: fresh clones of `open-meteo/open-meteo` (server, commit of 2026‑09‑23) and `open-meteo/open-meteo-website` (docs, 2026‑09‑24); live S3 requests (tile decode, COG IFD lists, CORS pre-flights, a re-run of the slope table); the installed `@capacitor/*` type definitions; and independent third-party code on GitHub. The same egress blocks applied (Open-Meteo, BoM, RFS, SIX, DCCEEW, DEA Hotspots, FIRMS, ArcGIS Online), so NSW/RFS/BoM facts stay [3P]. Corrections are marked **CORRECTED** in place. The ones that change the design are:

1. **`models=ecmwf_ifs` (IFS HRES 9 km) has NO pressure-level fields.** The docs say so ("no pressure-level fields. Pressure-level data is available only from the 0.25° open-data models"), and the server's `EcmwfEcdpsIfsVariable` enum has none. A pressure-level request to `ecmwf_ifs` returns arrays of `null`. Vertical profiles must come from `ecmwf_ifs025` (0.25°, 3-hourly) or `ncep_gfs_global` (0.25°, hourly to 120 h).
2. **Open-Meteo's elevation correction is not "temperature only".** It applies to every variable flagged `isElevationCorrectable` with unit °C. For `ecmwf_ifs` that includes **`dew_point_2m`**. RH is then derived from the shifted T and T_d, so the dew-point depression is kept and RH changes only slightly.
3. **NSW RFS `majorIncidents.json` CORS:** a 2026 third-party test reports `Access-Control-Allow-Origin: *` **when an `Origin` header is sent**, which browsers always do. The older "no CORS" reports are from 2015–2019.
4. **`Filesystem.downloadFile` is deprecated since Capacitor 7.1.0.** Use `@capacitor/file-transfer`.
5. **NSW 5 m DEM provenance is disputed.** One 2026 source says "LiDAR resampled to 5 m"; another says "stereo-photogrammetry, NOT LiDAR". A photogrammetric surface in forest partly follows the canopy, which matters for gully slopes (§3.5).
6. **New sources added:** Digital Atlas of Australia national fire-history and near-real-time fire-extent services (CORS \*), NSW FESM fire-severity WMS, and RFS hazard-reduction feed format. Also a warning: DEA `recent-hotspots.json` is **about 149 MB**, so a phone must never fetch it.

---

## 1. Executive summary: what matters most for FireSim

1. **Weather comes from Open-Meteo. Pick the model explicitly and do our own terrain downscaling.**
   - One keyless JSON API (`/v1/forecast`) gives current conditions, past data (`past_days` 0–92) and forecast data (up to 16 days) [S].
   - Pressure-level profiles (T, RH, wind, geopotential height at 1000…30 hPa) initialise the 3-D atmosphere [S].
   - **BoM ACCESS-G via Open-Meteo has no pressure levels, CAPE or PBL height**. Open-Meteo's BoM page also says *"BOM … open-data delivery has been temporarily suspended"* [S].
   - Use **ECMWF IFS HRES 9 km (`models=ecmwf_ifs`)** as the primary **surface** source. It has been open data (CC BY 4.0) since 1 Oct 2025, and provides `boundary_layer_height`, `cape`, native 2 m dew point and native 10/100/200 m winds [S] (verified: `ecmwf-api/+page.svelte`; `EcmwfEcpdsVariable.swift`).
   - **CORRECTED: IFS HRES 9 km has no pressure levels** [S] (verified: docs text *"The IFS HRES 9 km model additionally provides native dew point, direct radiation, visibility, showers and boundary layer height, but no pressure-level fields. Pressure-level data is available only from the 0.25° open-data models"*; the server's `EcmwfEcdpsIfsVariable` enum has no `*_hPa` cases). Take the **vertical profile** from **`ecmwf_ifs025`**: 0.25°, 3-hourly (Open-Meteo interpolates it to hourly), levels 1000/925/850/700/500/300/250/200/150/50 hPa. A server comment says 600/400/100 hPa are "only AIFS", so treat those as uncertain for IFS 0.25° [S]. Alternatively use **`ncep_gfs_global`**: pressure variables at 0.25°, hourly to 120 h, 25 hPa steps from 1000 to 100 hPa [S]. **ICON global** has 80/120/180 m winds. Its levels are 1000/950/925/900/850/800/700/… hPa (no 975) [S] (verified: `Icon.swift` `levels`).
   - **CORRECTED:** Open-Meteo applies a fixed **0.0065 K m⁻¹** shift, `ΔT = (z_model − z_target)·0.0065`. It applies it to *every* variable that the model flags `isElevationCorrectable` and that is in °C, not only 2 m temperature [S] (verified: `GenericReader.swift` `scale()`). The set varies by model:
     - `ecmwf_ifs`: `temperature_2m`, **`dew_point_2m`**, T max/min, surface and soil temperatures (verified: `EcmwfEcpdsVariable.swift`).
     - ICON: 2/80/120/180 m temperatures and soil temperatures.
     - GFS: 2/80/100 m temperatures and soil temperatures.
     - Winds, pressure and all pressure-level fields are never adjusted.
     - For `ecmwf_ifs`, RH is recomputed from the shifted T and T_d, so the dew-point depression is preserved and RH changes by only a few %.

     A single standard lapse rate is wrong in mountains with inversions or cold pools, so FireSim must downscale from the pressure levels itself (§5.3).
   - CORS is open to all origins, verified in the server's `configure.swift` [S]. Free use is limited to non-commercial use: under 10 000 calls/day, 5 000/hour and 600/minute; data is CC BY 4.0 [S]. Education counts as non-commercial [S] (verified: `terms/+page.svelte`, *"Incorporating our service into educational content"*). The exception is an app with subscriptions or ads.
   - **Mountain caveat (why this matters for fire):** at a 9–25 km grid the Blue Mountains plateau, the Grose/Jamison valleys and the Kosciuszko main range are one smoothed "hill". So the forecast has no valley cold pools, no ridge-top wind speed-up, no slope/valley wind reversals and no gully channelling. FireSim's own 3‑D terrain model has to add these, and the insight cards should say that the forecast cannot see them (§6).
2. **Past weather:**
   - **Historical Forecast API**: IFS HRES 9 km from **2017‑01‑01** (surface only, since it has no pressure levels). IFS 0.25° is available from 2024‑02‑03 and IFS 0.4° from 2022‑11‑07. GFS and GFS pressure variables start 2021‑03‑23 and ACCESS-G 2024‑01‑18 [S] (verified: `historical-forecast-api/+page.svelte` table).
     - **CORRECTED:** a Black Summer (Dec 2019) replay therefore has **no pressure-level profile** from Open-Meteo. It must use ERA5 pressure levels from the Copernicus CDS, which is off-device and outside Open-Meteo [K], or the surface fields only.
   - **Archive API**: ERA5 from 1940, ERA5‑Land from 1950 and IFS 9 km from 2017 (*"Every 6 hours with no delay"*). ERA5 and ERA5‑Land have a **5-day delay**. There are **no pressure levels** [S].
   - **Single Runs API**: re-play a forecast exactly as issued (`run=`); IFS HRES from March 2024 [S].
3. **BoM station observations are the ground truth, but they are awkward to get.**
   - The `fwo/IDN60801/IDN60801.<WMO>.json` feed is the easy route: 72 h of half-hourly observations with `air_temp`, `dewpt`, `rel_hum`, `wind_dir`, `wind_spd_kmh`, `gust_kmh` and `delta_t` [3P].
   - The feed has **no CORS** [3P]. BoM **blocks non-browser clients** and states *"The Bureau of Meteorology website does not support web scraping"*, pointing to the anonymous FTP or the paid Registered User service [3P].
   - Use it only through native HTTP, on the user's explicit request, rate-limited, and never as a background poller [H].
   - Katoomba (Farnells Rd) is **WMO 94744**; Mount Boyce AWS is **94743** [3P].
4. **Terrain.** Use **three sources**, in order of preference:
   - **(a) NSW Spatial Services statewide 5 m DEM** (`NSW_5M_Elevation/ImageServer/exportImage`, Float32 GeoTIFF, CC BY 4.0) [3P, used by four independent projects in 2026]. Cold responses can take about 28 s [3P].
     - **UNVERIFIED provenance:** jo-chemla/terrain-viewer says "1m/2m LiDAR resampled to a 5m statewide grid". nico579/lidar2map says "stereo-photogrammetry (NOT LiDAR)". It may be a mosaic of both.
     - Read the service `?f=json` description on device. Where the source is photogrammetric, forested gully slopes may be biased by canopy.
   - **(b) Geoscience Australia 1″ SRTM-derived DEM/DEM‑S** as a **CORS-enabled, 512-px-tiled Float32 COG** for all of Australia on `dea-public-data`. It is bare-earth corrected [V]. It sits **2.5–8 m below raw SRTM** at our four Blue Mountains sample sites. That matches the removal of the vegetation offset [V].
   - **(c) AWS Terrain Tiles (Terrarium)**: `h = R·256 + G + B/256 − 32768`. Verified **1021–1022 m at Katoomba**; the header shows the source is `srtm/S34E150.tif`, so over NSW this is **SRTM 1″ (~30 m)** [V]. Zoom 13–15 tiles are only interpolated SRTM [V, S].
   - **Resolution matters for slope**. We measured this on SRTM around Katoomba. The 99th-percentile slope is **58.6° at 30 m, 48.3° at 90 m and 37.8° at 180 m** [V]. The fire model must use the finest DEM available, and the atmosphere model a separately smoothed one.
5. **Fuel structure layers** are all CC BY 4.0 and cacheable:
   - **Meta/WRI 1 m canopy height**: uint8 metres in EPSG:3857 tiles named by zoom-9 quadkey (Katoomba = `311230121`). The files are **1-row strips with no overviews and no CORS** [V], so pre-process them off-device.
   - **ESA WorldCover 10 m v200 (2021)**: 3°×3° COGs, tiled 1024, 6 overviews, **no CORS** [V].
   - **NSW SVTM PCT map** (`VIS/SVTM_NSW_Extant_PCT/MapServer`) [3P].
   - **DEA Sentinel‑2 live fuel moisture content (`ga_s2_fmc_3_v1`)**: 20 m COG in %, **CORS \***, current to 2026‑09‑10 for tile 56HKH [V] (re-verified: bucket listing shows two datatakes on 2026‑09‑10). This is a bonus layer for live FMC in the elevated and near-surface fuels.
6. **Fire history comes from NPWS Fire History** (`Fire/NPWS_Fire_History/MapServer/0`).
   - Fields: `FireName`, `FireNo`, `FireType` (**1 = wildfire, 2 = prescribed burn**), `FireYear` (season code such as `201920`), `Label`, `StartDate`, `EndDate`, `AreaHa`, `PerimeterM`, `Intensity`, `OFHObjMet`, `ObjNotMet`, `NPWSBranch`, `NPWSArea` and `VerDate` [3P] (verified by two independent field lists: uprez-net/propure-main and chulund/redbackfire-static).
   - It includes Black Summer [3P]. Rasterise it to *time since fire* for fuel accumulation.
   - **NEW:** add the national **Digital Atlas "Historical Bushfire Boundaries"** (1899–2023, CC BY 4.0). It covers fires outside the NPWS estate. Also add **NSW FESM** fire-severity maps (per season, 2016‑17 onwards), because *how hard* an area last burnt changes how its fuel regrows (§3.11) [3P].
7. **Incidents and hotspots**:
   - **NSW RFS `majorIncidents.json`**: GeoJSON with GeometryCollections (point plus fire-extent polygons). `category` is one of Emergency Warning, Watch and Act, Advice, Not Applicable or Planned Burn. The fields STATUS, TYPE, SIZE, COUNCIL AREA, LOCATION, FIRE and RESPONSIBLE AGENCY are packed into an HTML `description` string [3P]. The licence is CC BY 4.0.
     - **CORRECTED CORS:** a 2026 browser app reports that RFS *"sends ACAO: \* only when an Origin header is present, which browsers always do"* (ben-gy/au-bushfires `src/live.ts`) [3P]. The older "no CORS" reports date from 2015–2019. Test on device and keep native HTTP as the fallback.
   - **Digital Atlas of Australia near-real-time bushfire extents** (`Near_Real_Time_Bushfire_Boundaries_view/FeatureServer/3`) are national, about 3-hourly, CC BY 4.0, and reported **CORS \*** [3P]. **NEW.**
   - **DEA Hotspots WFS** (`public:hotspots`, `public:hotspots_three_days`; CC BY 4.0; updated every 10 min) [S] (verified: dea-knowledge-hub `_data.yaml`, `data_update_frequency: 10_MIN`, coverage from 27 Aug 2002).
     - The 10-min cadence comes from the Himawari geostationary detections, which are coarse at about 2 km or more [K].
     - **Never fetch `recent-hotspots.json` on a phone**: it is about 149 MB and 175 000 features for all of Australia [3P]. Use a bbox WFS query instead.
   - **NASA FIRMS** needs a free MAP_KEY. The area API accepts `DAY_RANGE` 1–5 only: three independent 2026 client repos measured this, although the older docs say 1–10. The limit is 5 000 transactions per 10 min [3P].
8. **Transport rule for the app** [S, from our `src/data/http.ts`, and H]:
   - All network I/O runs on the **main thread** through `CapacitorHttp`. The Web Worker has no native bridge.
   - Binary data is fetched as base64 or downloaded to disk, then handed to the worker as transferable `ArrayBuffer`s. **CORRECTED:** `Filesystem.downloadFile` still exists in `@capacitor/filesystem` 8.1.3 but is marked *"@deprecated Use the @capacitor/file-transfer plugin instead"* since 7.1.0 (verified: installed `definitions.d.ts`). Use `@capacitor/file-transfer` for pack downloads.
   - Imagery for Three.js textures must arrive as bytes and then go through `createImageBitmap`. A cross-origin `<img>` without CORS would taint WebGL.
9. **Area packs are mandatory.** A 10 km × 10 km pack is about **15–40 MB** (§5.5):
   - 5 m DEM resampled to 10 m;
   - SRTM fallback;
   - imagery at z16 (400 tiles at 1.99 m/px);
   - canopy height, WorldCover, SVTM and fire history rasterised to 10 m;
   - 16 days of forecast plus 92 days of past weather;
   - a licence and attribution manifest.

   Everything in the recommended pack is CC BY 4.0 or public domain. **Do not cache Esri World Imagery or Mapbox tiles**: they are proprietary and require keys and terms [K].

---

## 2. Why data choices change mountain fire behaviour (mechanisms)

### 2.1 Terrain: bare earth vs surface models, and resolution

- **Fire needs the ground surface (DTM), not the canopy surface (DSM).**
  - SRTM C-band radar returns a surface partly inside the canopy. GA's DEM product removes this vegetation offset (Gallant et al. 2011).
  - In our Blue Mountains sample, GA DEM was lower than raw SRTM by **2.5 m** (Katoomba town), **6.0 m** (Jamison Valley forest), **5.9 m** (Leura forest) and **8.1 m** (Mt Boyce), as means of 30 × 30 cells [V].
  - Copernicus GLO‑30 is also a DSM. Its tall-forest edges create false 10–40 m steps [K]. Those steps become false slopes, and slope is the variable that most affects rate of spread: ROS about doubles per 10° upslope (see document 01).
- **Resolution smooths the landform that drives mountain fire.** The Blue Mountains are sandstone plateaux cut by vertical cliffs and steep gullies. We computed Horn (1981) slopes in a 10 km box at Katoomba from SRTM 1″ and from block-averaged copies [V]:

| DEM cell | median slope | p90 | p99 | max | % area > 20° | % > 30° | % > 40° |
|---|---|---|---|---|---|---|---|
| ~30 m (SRTM 1″) | 11.9° | 27.4° | 58.6° | 76.3° | 23.3 | 7.3 | 3.3 |
| ~90 m | 9.7° | 25.7° | 48.3° | 57.8° | 18.0 | 6.9 | 3.2 |
| ~180 m | 7.4° | 24.7° | 37.8° | 43.6° | 15.4 | 5.3 | 0.4 |

(verified: re-run by the fact-checker on the same `S34E150.hgt.gz`, bbox lat −33.755…−33.665 and lon 150.256…150.364, Horn slope, block means of 1, 3 and 6 cells. Every value was reproduced; p90 at 30 m came out 27.3° instead of 27.4°. The cells are really 26 × 31 m, 77 × 93 m and 154 × 185 m. The GA-DEM-minus-SRTM offsets of 2.5, 6.0 and 8.1 m below were also reproduced.)

  Consequences:
  - At the 100–200 m atmosphere grid, **the cliff lines disappear**: cells steeper than 40° fall from 3.3 % to 0.4 %.
  - At 30 m the slopes still under-represent LiDAR cliffs. SRTM itself is roughly 30 m and smooths vertical walls [K].
  - So FireSim should derive **fire-grid slope from the 5 m NSW DTM, aggregated to the 10–30 m fire cell**. The atmosphere should use a **deliberately smoothed** DEM, because terrain-following coordinates become unstable on very steep cells [K] (see document on atmosphere numerics).
- **Aspect and insolation.** A 5–30 m DEM resolves gully walls. Their solar exposure controls dead fuel moisture differences between north-west and south-east facing slopes (document 04).
- **Datums.** SRTM heights are on the EGM96 geoid [K]. NSW DEMs are on AHD [K]. The offset is small relative to fire-relevant relief [K] and can be ignored for slope, but not when merging tiles from different sources without blending.

### 2.2 Weather: global models see a smoothed mountain

- **Grid size.** IFS HRES has 9 km cells, ICON global 11 km, ACCESS-G 15 km and GFS 13 km (0.25° for pressure levels) [S]. The Jamison Valley (about 400 m deep, 3–5 km wide) is **sub-grid** in all of them. Model output represents a smoothed "grid-cell mountain", and valley–ridge differences must be reconstructed.
- **Open-Meteo "downscaling".**
  - Open-Meteo chooses a land grid cell with similar elevation, using a 90 m DEM (`cell_selection=land`, the default) [S].
  - It then shifts the **temperature-type variables** by `ΔT = (z_model − z_target)·0.0065 K/m` [S] (verified: `GenericReader.swift`, comment *"correct temperature by 0.65° per 100 m elevation"*).
    - **CORRECTED:** for `ecmwf_ifs` the shifted variables include `dew_point_2m`. For ICON they include the 80/120/180 m temperatures.
  - Wind, pressure-level fields and native RH are **not** adjusted [S].
  - With `elevation=nan`, *"all downscaling is disabled and the average grid-cell elevation is used"* [S] (verified: docs `+page.svelte`).
  - In the evening and at night, cold air pools in NSW valleys (document 02), so a lapse-rate adjustment warms valley floors that are really colder and moister. By day on a dry, well-mixed afternoon it is about right [K].
  - FireSim should ask for `elevation=nan` (raw grid-cell values) plus pressure levels, then build its own vertical profile (§5.3).
- **Time semantics differ by variable.**
  - Temperature, RH and wind are **instantaneous** at the hour.
  - `wind_gusts_10m` is the **maximum over the preceding hour**. `precipitation` is the **sum** over the preceding hour. `shortwave_radiation` is the **mean** over the preceding hour [S].
  - BoM observations are half-hourly snapshots [3P].
  - Mixing these without care shifts gusts and solar forcing by half an hour to an hour.
- **Dry air aloft.** `relative_humidity_700hPa`/`850hPa` together with `boundary_layer_height` show whether afternoon mixing will bring dry upper air down onto ridges. This is one of the main mountain-specific drivers of sudden RH drops (document 02). Only models with pressure levels give this [S] (verified: server source):
  - `ecmwf_ifs025`, GFS and ICON do.
  - **`ecmwf_ifs` 9 km does not, and nor does ACCESS-G.**
  - The IFS 9 km gives `boundary_layer_height` but no levels; the IFS 0.25° gives levels but no `boundary_layer_height` (it is absent from `EcmwfVariable`). So a combined request `models=ecmwf_ifs,ecmwf_ifs025` is needed, and the two grids are not the same.
- **Pressure levels vs NSW terrain heights.** Typical heights are 1000 hPa ≈ 100 m, 925 hPa ≈ 750 m, 850 hPa ≈ 1 450 m and 700 hPa ≈ 3 000 m. These are standard-atmosphere values [K]; always use the returned `geopotential_height_<L>hPa`.
  - On the Blue Mountains plateau (~1 000 m), 1000 hPa and often 925 hPa are **below the ground**, and 850 hPa is only ~450 m above the ridge.
  - On the Kosciuszko main range (~2 000–2 228 m), even 850 hPa is underground.
  - So for ridge-top fire weather the relevant model level is the first one *above* the local terrain. With ECMWF's coarse spacing (925 → 850 → 700) the vertical resolution there is 700–1 500 m. GFS's 25 hPa spacing (~250 m) is much better for resolving an inversion top near ridge height.

### 2.3 Fuel: structure, history and live moisture

- **Canopy height and cover** (Meta 1 m, ETH 10 m) and **land cover** (WorldCover) tell us *where* forest, shrub and grass are. **SVTM PCTs** tell us *what* community it is, which maps to AFDRS fuel types and hazard scores (document on fuels).
- **Fire history → time since fire → fuel load.** An Olson-type accumulation `w(t) = w_ss (1 − e^{−k t})` (Olson 1963) turns NPWS polygons into load. Here `w` is fuel load (t ha⁻¹), `w_ss` is the steady-state load, `k` is a decomposition constant (yr⁻¹) and `t` is the time since fire (yr). Parameter values per fuel type are in the fuels document [K]. (verified against document 05: the operational form is `X(t) = X_ss(1 − e^{−kt})`, per layer and fuel type, as coded in PyroXL `AFDRS_General.bas`. For a patchy prescribed burn use the residual form `X(t) = X_ss(1 − e^{−kt}) + X₀e^{−kt}`.)
  - FireType = 2 (prescribed burn) usually reduces surface and near-surface fuel but may leave elevated fuel and bark partly intact [K]. Keep FireType, because the insight cards should say so.
  - **Fire severity matters as well as fire date (NEW).** NSW **FESM** (Fire Extent and Severity Mapping) is published per season as a WMS, `mapprod3.environment.nsw.gov.au/arcgis/services/Fire/FESM/MapServer/WMSServer`. Layer 1 is 2023‑24, layer 2 is 2022‑23, and so on to layer 8 for 2016‑17 [3P] (verified: gangerang/bushwalkers-topos `index.html`, which uses it live).
  - A canopy-scorching fire in wet or dry sclerophyll forest in the ranges often produces dense post-fire regrowth (eucalypt epicormic and seedling thickets, acacia). That can raise *elevated* fuel within a few years even though litter restarts at zero [K].
  - A time-since-fire value alone misses this. Use FESM severity as a modifier on the elevated-fuel curve, and let the user override it.
- **Live fuel moisture.** DEA's Sentinel‑2 LFMC (%) product (Yebra et al. 2018 method, the Australian Flammability Monitoring System [K]) gives 20 m live moisture about every 5 days, where there is no cloud. Around Katoomba on 2026‑08‑31 it read p10 48 %, median 98 % and p90 166 % [V]. On cloudy dates it is entirely no-data (−999) [V]. It is **live** moisture, not the leaf-litter (dead) moisture, which must come from the weather-driven model (document 04).

### 2.4 Incidents and hotspots: approximate by nature

Hotspots are **pixel detections**, not fire-edge positions. The nominal footprints are about 375 m for VIIRS I-band and about 1 km for MODIS at nadir, and larger off-nadir [K]. The Himawari‑8/9 AHI detections that give DEA Hotspots its 10-minute cadence are about 2 km at the sub-satellite point (140.7° E) and coarser over NSW [K]. Latency is minutes (Himawari) to hours (polar orbiters) [K]. In steep terrain, a detection on a cliff or a deep gully wall is also geolocated as if on flat ground, so it may sit a pixel or more off [K]. The app should show them as "somewhere in this pixel, some time in the last N hours" and never auto-ignite a single cell from one hotspot [H].

---

## 3. Source-by-source reference

Each entry gives the endpoint, an example for Katoomba, the response, CORS, limits, the licence and caching rules, and the status.

### 3.1 Open-Meteo Forecast API (`/v1/forecast`) [S unless stated]

- **Endpoint.** `https://api.open-meteo.com/v1/forecast`. Commercial use is at `customer-api.open-meteo.com` with `&apikey=`.
- **Parameters:**
  - `latitude` and `longitude` (comma lists allowed; output becomes a list and each location counts toward the limits);
  - `elevation` (float, comma list, or `nan` to disable downscaling);
  - `hourly`, `daily`, `current`, `minutely_15`;
  - `timezone` (`Australia/Sydney` or `auto`);
  - `past_days` (0–92), `forecast_days` (0–16), `past_hours`, `forecast_hours`, `start_date`/`end_date` (yyyy‑mm‑dd), `start_hour`/`end_hour` (yyyy‑mm‑ddThh:mm);
  - `models` (comma list);
  - `cell_selection` (`land` default, `sea`, `nearest`);
  - `wind_speed_unit` (`kmh` default, `ms`, `mph`, `kn`), `temperature_unit`, `precipitation_unit`;
  - `timeformat` (`iso8601` or `unixtime`, where unixtime is UTC).
- **Hourly variables relevant to FireSim** (exact names, units):
  - `temperature_2m` °C, `relative_humidity_2m` %, `dew_point_2m` °C, `vapour_pressure_deficit` kPa;
  - `wind_speed_10m|80m|120m|180m`, `wind_direction_10m|80m|120m|180m` °, `wind_gusts_10m` (max over the preceding hour);
  - `shortwave_radiation`, `direct_radiation`, `diffuse_radiation` W m⁻² (mean over the preceding hour);
  - `cloud_cover`, `cloud_cover_low|mid|high` %, `precipitation` mm (sum over the preceding hour);
  - `soil_moisture_0_to_1cm|1_to_3cm|3_to_9cm|9_to_27cm|27_to_81cm` m³ m⁻³;
  - `cape` J kg⁻¹, `lifted_index`, `convective_inhibition`, `boundary_layer_height` m, `freezing_level_height` m, `is_day`;
  - pressure-level variables `temperature_<L>hPa`, `relative_humidity_<L>hPa`, `dew_point_<L>hPa`, `cloud_cover_<L>hPa`, `wind_speed_<L>hPa`, `wind_direction_<L>hPa`, `vertical_velocity_<L>hPa`, `geopotential_height_<L>hPa` (m above MSL). Generic levels are L ∈ {1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30} (verified: `docs/options.ts` `levels`). Each model has its own subset (table below).
  - Soil-layer names differ by model. The generic/ICON names are `soil_moisture_0_to_1cm…27_to_81cm`; ECMWF uses `soil_moisture_0_to_7cm|7_to_28cm|28_to_100cm|100_to_255cm`; BoM uses `0_to_10cm…` [S].
- **Variables differ per model** (verified: each model's `options.ts` in open-meteo-website plus the server variable enums, 2026‑09‑24) [S]:

| Model id | Grid | Near-surface winds | Pressure levels (≤ 700 hPa) | CAPE / PBL | Notes |
|---|---|---|---|---|---|
| `ecmwf_ifs` | 9 km (O1280), hourly to +90 h, 3-hourly to +144 h, 6-hourly to 15 d | 10, 100, 200 m native. 80/120 m are scaled from 100 m and 180 m from 200 m (FAO-56 log factor, E19) | **CORRECTED: none** | cape ✔ (MUCAPE), boundary_layer_height ✔ | native 2 m dew point; open data (CC BY 4.0) since 1 Oct 2025 |
| `ecmwf_ifs025` | 0.25° (~25 km), 3-hourly (interpolated to hourly), 15 d | 10, 100 m | 1000, 925, 850, 700 (+500…50; 600/400/100 uncertain) | cape ✔, **no PBL** | levels carry vertical velocity; the docs omit dew point, but the server derives `dew_point_<L>hPa` from T and RH. About 2 h extra delay vs real-time IFS |
| `ncep_gfs_global` | 0.11° surface; 0.25° pressure; hourly to 120 h, then 3-hourly; 16 d | 10, 80, 100 m (120 m power-law scaled from 100 m) | 1000, 975, 950, …, 700 in 25 hPa steps (down to 100 hPa) | cape, lifted_index, CIN, PBL ✔ | dew point and vertical velocity on levels |
| `dwd_icon_global` | 0.1° (~11 km), hourly to 78 h, then 3-hourly; **7.5 d** | 10, 80, 120, 180 m | 1000, 950, 925, 900, 850, 800, 700 (+600…30) — **no 975** (verified: `Icon.swift`) | cape ✔ | soil moisture 0–1 cm … 27–81 cm |
| `bom_access_global` | 0.15° (~15 km), 10 d, 4 runs/day | 10, 40, 80, 120 m | **none** (verified: `BomVariable.swift`) | **no CAPE**, no PBL | *"open-data delivery has been temporarily suspended"* (verified: `bom-api/+page.svelte`) |

- **Katoomba examples** (my URLs, built from the docs; not fetched because the host was blocked):
  - (A) now + 3 days back + 3 days ahead, surface, ECMWF, raw grid cell:
    ```
    https://api.open-meteo.com/v1/forecast?latitude=-33.71&longitude=150.31&elevation=nan&models=ecmwf_ifs&timezone=Australia%2FSydney&wind_speed_unit=ms&past_days=3&forecast_days=3&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,vapour_pressure_deficit,precipitation,cloud_cover,shortwave_radiation,direct_radiation,diffuse_radiation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_100m,wind_direction_100m,wind_speed_200m,wind_direction_200m,boundary_layer_height,cape,soil_moisture_0_to_7cm
    ```
  - (B) vertical profile, ECMWF. **CORRECTED:** use `ecmwf_ifs025`. With `models=ecmwf_ifs` every `*_hPa` array comes back `null` with unit `undefined` (verified: `ForecastapiController.swift` fills unavailable variables with NaN, and the IFS 9 km has no levels):
    ```
    …&models=ecmwf_ifs025&hourly=temperature_1000hPa,temperature_925hPa,temperature_850hPa,temperature_700hPa,relative_humidity_1000hPa,relative_humidity_925hPa,relative_humidity_850hPa,relative_humidity_700hPa,wind_speed_925hPa,wind_speed_850hPa,wind_speed_700hPa,wind_direction_925hPa,wind_direction_850hPa,wind_direction_700hPa,geopotential_height_1000hPa,geopotential_height_925hPa,geopotential_height_850hPa,geopotential_height_700hPa
    ```
  - (C) denser profile, GFS: the same pattern with `models=ncep_gfs_global` and levels `975,950,925,900,875,850,825,800,775,750,725,700`, plus `dew_point_<L>hPa` and `vertical_velocity_<L>hPa`.
  - (D) boundary-layer winds, ICON: `models=dwd_icon_global&hourly=wind_speed_80m,wind_speed_120m,wind_speed_180m,wind_direction_80m,wind_direction_120m,wind_direction_180m,temperature_80m,temperature_120m,temperature_180m`.
  - (E) spread across models: `models=ecmwf_ifs,ecmwf_ifs025,ncep_gfs_global,dwd_icon_global`. With several models the response keys carry the model name, e.g. `temperature_2m_ecmwf_ifs` [S] (verified: `ForecastApiResult.swift`: `results.count > 1 ? "\(variable)_\(modelName)" : variable`).
  - (F) 3 × 3 points across the domain in one call, e.g. `latitude=-33.665,-33.665,-33.665,-33.71,…&longitude=150.256,150.31,150.364,…&elevation=nan,…`. With 9 km cells this mostly samples 1–4 distinct cells, but it captures model gradients [H].
- **Response.** JSON with `latitude`/`longitude` (the grid-cell centre used, possibly several km away), `elevation`, `generationtime_ms`, `utc_offset_seconds`, `timezone`, `timezone_abbreviation`, `current{time,interval,…}`, `hourly{time[],<var>[]}`, `hourly_units{}`, `daily{}` and `daily_units{}` (verified: `JsonWriter.swift` header).
  - `elevation` is the 90 m DEM value used for downscaling. With `elevation=nan` the docs say the average grid-cell height is used; whether that height is echoed in the field is unverified.
  - Errors return HTTP 400 with a JSON body.
  - Unavailable variables return `null` arrays with unit `"undefined"` [S] (verified: server fills them with NaN). **Always check for all-null arrays**: a wrong model/variable pairing fails silently.
  - Limits: `past_days` is documented as 0–92, and the server accepts up to 93 (`historyStartDate = today − 93 d`). `forecast_days` max is 16 [S].
- **CORS.** Allowed from every origin. The server source has `CORSMiddleware.Configuration(allowedOrigin: .all, allowedMethods: [.GET, .POST, .OPTIONS], …)` [S].
- **Limits (free).** Under 10 000 calls/day, 5 000/hour, 600/minute and 300 000/month [S] (verified: `pricing/+page.svelte` and `terms/+page.svelte`). **Call weight** [S] (verified: website calculator *and* server `ForecastApiResult.calculateQueryWeight()`, with `referenceDays = 14` and `referenceVariables = 10`):
  `w = Σ_locations max(1, max(nV·nM/10, (T/14)·nV·nM/10))`,
  where:
  - `nV` is the number of variables;
  - `nM` is the number of models (the server uses "variables × domains");
  - `T` is the number of days in the **whole requested time range, past_days included** (server: `time.range.durationSeconds / 86400`);
  - the sum runs over locations.

  Worked cost examples:
  - 40 variables × 1 model × 7 days gives `w = max(4, 2) = 4` calls.
  - A full FireSim refresh (surface 20 variables + profile 40 variables, 3 models, 9 points, `past_days=3`, `forecast_days=3`) is 9 × 18 = **162** weighted calls [V‑computed].
  - **Watch the time term:** the same request with `past_days=92, forecast_days=16` (T = 108) costs 9 × 18 × 7.7 ≈ **1 250** calls, about an eighth of the daily free allowance.
  - So fetch the 92-day history only for the few daily/surface variables the fuel-moisture and drought models need, at one point. Fetch profiles only for the scenario window [H].
- **Licence and caching.** API data is **CC BY 4.0**; a link next to the displayed data is required [S]. Caching and redistributing inside area packs is allowed with attribution [S]. The free tier is for **non-commercial** use: *"Incorporating our service into educational content"* is listed as non-commercial, while apps with subscriptions or ads are commercial [S]. The server code is AGPLv3, which is irrelevant for API use [S]. Logs hold coordinates for up to 90 days [S] (verified: terms, *"All log files will be deleted after a period of 90 days"*), which matters for privacy notes.

### 3.2 Open-Meteo past weather [S]

| API | Endpoint | Coverage | Use in FireSim |
|---|---|---|---|
| `past_days` on the forecast API | `api.open-meteo.com/v1/forecast?past_days=N` | up to 92 days | spin up the dead fuel moisture model and drought factor for the last 1–92 days |
| Historical Forecast | `https://historical-forecast-api.open-meteo.com/v1/forecast?start_date=…&end_date=…` | Stitched first hours of each run. IFS HRES 9 km from **2017‑01‑01** (surface only). IFS 0.4° from 2022‑11‑07. IFS 0.25° from 2024‑02‑03. GFS and GFS pressure from 2021‑03‑23. ACCESS-G from 2024‑01‑18. "including atmospheric pressure levels" means *for models that have them* (verified: `historical-forecast-api/+page.svelte`) | Replay past fires with the same variables as the forecast API. **CORRECTED:** there are no Open-Meteo pressure-level profiles before 2021‑03‑23 (GFS), so Black Summer 2019‑20 replays get surface fields only [S] |
| Single Runs | `https://single-runs-api.open-meteo.com/v1/forecast?run=2025-09-01T00:00` (UTC init time) | most models from 2 Apr 2026; IFS HRES from Mar 2024 (verified: `ecmwf-api/+page.svelte`, `single-runs-api/+page.svelte`) | "what did the forecast say that morning" teaching scenarios |
| Archive (reanalysis) | `https://archive-api.open-meteo.com/v1/archive?start_date=…&end_date=…&models=era5_land` | ERA5 0.25° from 1940; ERA5‑Land 0.1° from 1950; `ecmwf_ifs` 9 km from 2017, *"every 6 hours with no delay"*. ERA5 and ERA5‑Land have a **5-day delay**. **No pressure levels**. `boundary_layer_height` and 100 m wind are ERA5/IFS fields; ERA5‑Land is a land-surface reanalysis and does not carry them [K] | long drought and KBDI series (365 days of `precipitation_sum`, `temperature_2m_max`); `models=ecmwf_ifs` in the archive fills the last 5 days that ERA5 lacks |

Katoomba example (antecedent rain for KBDI):
`https://archive-api.open-meteo.com/v1/archive?latitude=-33.71&longitude=150.31&start_date=2025-09-01&end_date=2026-09-21&daily=precipitation_sum,temperature_2m_max&models=era5_land&timezone=Australia%2FSydney`
Fill the last 5–6 days from the forecast API `past_days`, or from the archive with `models=ecmwf_ifs`. The weight is 2 variables × 386 days, so max(0.2, 0.2 × 27.6) ≈ 5.5 calls [V‑computed].

**Mountain caveat for rainfall:** ERA5‑Land (~9–11 km) and ERA5 (~25 km) smooth orographic rain. The Blue Mountains escarpment and the Barrington/New England scarps get markedly more rain than the tablelands behind them. So a reanalysis KBDI/drought factor at one point can be biased for a specific gully [K]. Prefer the nearest BoM rain gauge when the user can supply it.

### 3.3 Bureau of Meteorology observations

- **JSON feed [3P].** `https://www.bom.gov.au/fwo/IDN60801/IDN60801.<WMO>.json`. `IDN60801` is the NSW/ACT product, `IDV60801` Victoria, and so on.
  - Near Katoomba: **94744** KATOOMBA (FARNELLS RD), station 063039, 1017 m; **94743** MOUNT BOYCE AWS, 063292, 1080 m; **94741** LITHGOW (COOERWULL), 063226, 900 m; **95744** SPRINGWOOD (VALLEY HEIGHTS), 063077, 320 m. The list comes from the OpenNEM `bom_stations.json` [3P] (re-checked: WMO, station number, lat/lon and altitude all match that file).
  - **Mountain note:** all four are ridge or plateau sites. There is no AWS on a Blue Mountains valley floor in this list, so a station reading describes the *ridge* air and not the gully the crew may be standing in [3P/K]. The insight card should say which one it is.
  - Structure is `observations.notice`, `observations.header[0].state_time_zone`, and `observations.data[]`, newest first, about 72 h at 30-minute steps.
  - Fields include `sort_order`, `wmo`, `name`, `history_product`, `local_date_time_full` (yyyymmddhhmmss local), `aifstime_utc`, `lat`, `lon`, `air_temp`, `apparent_t`, `dewpt`, `rel_hum`, `delta_t`, `wind_dir` (16-point text such as "NW"), `wind_spd_kmh`, `wind_spd_kt`, `gust_kmh`, `gust_kt`, `press`, `press_msl`, `press_qnh`, `rain_trace` (mm since 9 am, as a string), `cloud`, `cloud_oktas` and `vis_km` [3P].
- **CORS: none.** Several apps note *"BOM blocks CORS"* and use Capacitor native requests or a proxy [3P].
- **Bot blocking.** BoM returns 403 to bare HTTP clients; code from Aug 2026 needs a browser-like User-Agent [3P]. The block page reads [3P]:

  > *"The Bureau of Meteorology website does not support web scraping: if you are trying to access Bureau data through automated means, you should stop … An anonymous FTP channel … free to access, but use is subject to the default terms of the Bureau's copyright notice … A Registered User service … charges apply to most data products."*
- **Unofficial app API [3P].** `https://api.weather.bom.gov.au/v1/locations/{geohash}/observations`, `…/forecasts/hourly` and `…/forecasts/daily`. The geohash for Katoomba is `r64bhr` (6 characters, computed). This API was reverse-engineered from the BoM website and has *"no information about future access arrangements"*. Do not build on it [H].
- **Licence.** The default terms are at `http://www.bom.gov.au/other/copyright.shtml` [3P]. I could not read them this session [K]. Treat BoM data as **not cacheable for redistribution in area packs** until reviewed. Cache only on the device for the user's own session [H].
- **User-Agent tension [H].** §5.1 recommends an honest `User-Agent`, but BoM reportedly blocks non-browser UAs. **Do not spoof a browser UA to get round a block that BoM states is deliberate.** If the honest request is refused, show "station data unavailable" and ask for a belt-kit reading. Pursue the Registered User or FTP routes for any production use.
- **Recommendation.** Offer "Nearest BoM station" as an **on-demand comparison**: one request when the user taps, never polled. Use it for *nudging* the initial conditions and for insight cards such as "model says 25 % RH, Katoomba AWS says 14 %".

### 3.4 AWS Terrain Tiles (Mapzen/Tilezen "Joerd") [V, S]

- **URL patterns.**
  - `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png` (256², z 0–15)
  - `https://elevation-tiles-prod.s3.amazonaws.com/normal/{z}/{x}/{y}.png`
  - `https://elevation-tiles-prod.s3.amazonaws.com/geotiff/{z}/{x}/{y}.tif` (512²)
  - `https://elevation-tiles-prod.s3.amazonaws.com/skadi/{N|S}{yy}/{N|S}{yy}{E|W}{xxx}.hgt.gz`
  - There is also a replica bucket in `eu-central-1`.
- **Katoomba.** z12 → `terrarium/12/3758/2455.png`; z14 → `14/15032/9823`; z15 → `15/30065/19646`. Pixel RGB (131, 253, 0) decodes to **1021.0 m** at z12, 1022.09 m at z14 and 1022.15 m at z15. The skadi tile `S34/S34E150.hgt.gz` (14.0 MB gzip, 3601 × 3601 int16 big-endian = **1″ SRTM**) gives **1022 m** [V].
- **Sources.** The response header `x-amz-meta-x-imagery-sources: srtm/S34E150.tif` (plus GMTED at z12) shows the tiles are built from SRTM. Joerd lists GA's 5 m DEM only for "coastal regions in South Australia, Victoria, and Northern Territory", not the NSW ranges [V, S]. At z12 the values are integer metres (SRTM quantisation). At z14–15 they are resampled, carrying fractional bits but no new information [V].
- **Encoding.** `h = (R·256 + G + B/256) − 32768` m, with 1/256 m precision [S] (verified: Joerd `docs/formats.md`, *"(red * 256 + green + blue / 256) - 32768"*; re-decoded z12 pixel (49, 205) of tile 3758/2455 = RGB (131, 253, 0) = **1021 m** [V]).
- **Ground resolution.** `res = cos φ · 2π · 6378137 / (256 · 2^z)` m/px [S] (verified: Joerd `data-sources.md`). At −33.71° this gives 31.8 m (z12), 15.9 m (z13), 7.95 m (z14) and 3.97 m (z15) [V]. Joerd lists SRTM as *"30 meters (90 meters nominal quality)"*, so z12 already over-samples the source.
- **CORS.** `Access-Control-Allow-Origin: *`, GET, `Max-Age 3000`, and `x-amz-meta-x-imagery-sources` is exposed [V] (re-verified 2026‑09‑27: header `x-amz-meta-x-imagery-sources: srtm/S34E150.tif, gmted/50S150E_20101117_gmted_mea075.tif`).
- **Licence.** Attribution per the Joerd attribution list: *"… SRTM terrain data courtesy of the U.S. Geological Survey"*, and *"Australia terrain data © Commonwealth of Australia (Geoscience Australia) 2017"* where GA data is used [S]. Caching is permitted [S].
- **Alternative.** Mapterhorn (`https://tiles.mapterhorn.com/{z}/{x}/{y}.webp`, Terrarium encoding, 512 px) includes GA's LiDAR-derived 5 m DEM mosaics (`au5*` sources, from `elevation-direct-downloads.s3-ap-southeast-2.amazonaws.com/5m-dem/national_utm_mosaics/…`, 2026) [3P]. It could not be reached from the sandbox. Whether the Blue Mountains fall inside GA's 5 m coverage is **unknown** [K].
  - **Fact-check detail [V]:** the zone-56 file is `…/national_utm_mosaics/nationalz56_ag.zip`, 10 611 021 424 bytes, last modified 2021‑03‑09. The fact-checker read its zip64 central directory with a range request.
  - It holds exactly **one** GeoTIFF, `nationalz56_ag.tif`, plus a `.docx` metadata file titled *"Digital Elevation Model (DEM) 5 Metre Grid of Australia derived from LiDAR"*.
  - The GeoTIFF is compressed inside a zip, so it is **not range-readable**: pack-builder only.
  - A bare `56.zip` returns 403.

### 3.5 NSW Spatial Services elevation and ELVIS

- **NSW 5 m statewide DEM, ImageServer [3P, checked by two independent projects in 2026].**
  - Service: `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer`. `terrain-viewer` describes it as *"1m/2m LiDAR resampled to a 5m statewide grid … Verified Kosciuszko 2227.4 m against 2228 true. SLOW cold: 28 s"*. `property-scores` uses it as a *"statewide 5 m bare-earth DTM"*.
  - **CONFLICT (UNVERIFIED — no primary metadata reachable):** `nico579/lidar2map` (`providers/au_nsw.py`, 2026) says *"DEM dérivé de stéréo-photogrammétrie (PAS du LiDAR)"*. That means it would be derived from stereo photogrammetry, not LiDAR.
    - The service is probably a statewide mosaic: LiDAR where NSW has captured it (most of the eastern ranges since 2008–2019 [K]), photogrammetry elsewhere.
    - For fire this matters. A photogrammetric DSM-like surface under tall eucalypt forest in a gully would *under*-state slope and floor depth.
    - Action: read `…/ImageServer?f=json` (the `description`/`copyrightText` fields) and the NSW Spatial Services metadata before calling it "bare earth" in the UI. Compare it with GA DEM at a few forested gully floors: a LiDAR DTM should sit *below* GA DEM there.
  - **Size cap:** another independent client (CJKorn/Elev-Map, 2026) reads `maxImageWidth = 15 000` and `maxImageHeight = 4 100` from the service's own `?f=json` [3P]. So a 2000 × 2000 request is within limits. Tiling is still advised to limit per-request latency and memory.
  - **Web Mercator scale:** the bbox below is 12 021 m wide in EPSG:3857 units. That equals a 10.0 km ground box, because the Mercator scale factor is 1/cos 33.7° = 1.202. So 2000 px gives 6.0 m (3857) = **5.0 m ground** pixels [V‑computed]. Always size exports in *ground* metres.
  - Katoomba 10 km box in EPSG:3857, 2000 × 2000 px at 5 m:
    ```
    https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer/exportImage?bbox=16726422.0,-3995940.5,16738443.3,-3983919.2&bboxSR=3857&imageSR=3857&size=2000,2000&format=tiff&pixelType=F32&noData=-9999&noDataInterpretation=esriNoDataMatchAny&interpolation=RSP_BilinearInterpolation&f=image
    ```
    **Tile it** into 4–16 requests of ≤ 1024 px. ArcGIS services cap export size (`maxImageWidth/Height`, see `?f=json`); this one reportedly allows 15 000 × 4 100 [3P]. SIX's *imagery* MapServer returns HTTP 500 above 1024 px [3P]. Small tiles keep each cold request well under the ~28 s cold latency and are easy to retry.
  - Point query: `…/identify?geometry={"x":150.31,"y":-33.71,"spatialReference":{"wkid":4326}}&geometryType=esriGeometryPoint&returnGeometry=false&f=json`.
  - Contour fallback: `https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Elevation_and_Depth_Theme/FeatureServer/2/query` [3P].
- **CORS.** Not verified. ArcGIS Server enables CORS for all origins by default [K], and the 5 m service and SIX imagery are consumed directly by browser WebGL map apps [3P]. We still go through CapacitorHttp.
- **Licence.** CC BY 4.0, *"© State of New South Wales (Spatial Services …)"* [3P].
- **ELVIS** (`https://elevation.fsdf.org.au/`) is the national portal for 1 m/2 m/5 m LiDAR DEMs and point clouds. It is interactive and **order-based**, with no simple tile API [3P]. Use it **offline, in the pack-builder**, for sites where the 5 m product is not enough.
- **Geoscience Australia services.** `services.ga.gov.au/gis/...` DEM services are reported **decommissioned (404) or 403 to scripted clients** (2026) [3P]. **Use the GA 1″ DEM COGs on the DEA bucket instead [V]:**
  - `https://dea-public-data.s3.ap-southeast-2.amazonaws.com/projects/elevation/ga_srtm_dem1sv1_0/dem1sv1_0.tif` (bare earth), `…/dems1sv1_0.tif` (smoothed DEM‑S) and `…/demh1sv1_0.tif` (hydrologically enforced).
  - Each is about 34–38 GB, 147 600 × 122 400 Float32, 512² tiles, 8 overview levels, EPSG:4326, 1″, nodata −3.4e38, **CORS \***, CC BY 4.0, citing Gallant et al. 2011.
    - Re-verified [V]: `Content-Length` values are 34 524 353 459, 38 304 075 388 and 38 434 297 553 bytes.
    - Each has 9 IFDs (full resolution + 8 overviews). The origin is 112.99986° E, −10.00014° N.
    - A ranged GET with `Origin` returns `206` + `ACAO: *`, and the pre-flight allows the `range` header.
  - Katoomba centre pixel: **1022.0 m** (DEM) and 1020.4 m (DEM‑S) (re-verified [V]).
  - **Mountain caveat:** GA DEM-S is *adaptively smoothed* to remove SRTM noise. That also rounds off cliff lips and narrow ridges. Use DEM, not DEM‑S, for fire-grid slope, and DEM‑S or a further-smoothed field only for the atmosphere grid [K].
  - Range reads with `geotiff.js` work directly from the browser or worker, with no proxy.

### 3.6 Other DEMs (for completeness)

- **Mapbox Terrain-DEM v1.** `https://api.mapbox.com/v4/mapbox.mapbox-terrain-dem-v1/{z}/{x}/{y}.pngraw?access_token=…`, with `h = −10000 + 0.1·(R·65536 + G·256 + B)` m [3P]. It needs a token, and Mapbox terms restrict caching outside their SDKs [K]. **Not recommended.**
- **Copernicus GLO‑30 DSM.** `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S34_00_E150_00_DEM/Copernicus_DSM_COG_10_S34_00_E150_00_DEM.tif` responds 206 to range requests but has **no CORS header**: the pre-flight returns 403 [V].
  - Re-verified: the tile is 3600², origin 150° E, −33° N, so it covers lat −34…−33. It reads **1019.3 m** at Katoomba [V].
  - It is a surface model with canopy included [K].
- **Open-Meteo Elevation API.** `https://api.open-meteo.com/v1/elevation?latitude=…&longitude=…` returns Copernicus GLO‑90 point values [S]. Use it only to learn which elevation Open-Meteo used.

### 3.7 Imagery

- **NSW SIX Maps imagery [3P].**
  - XYZ tiles: `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}`. **Note the y/x order.** Load-balanced subdomains `maps1`…`maps4.six.nsw.gov.au` are also used [3P] (verified: gangerang/bushwalkers-topos uses `maps{s}` with `subdomains: '1234'`, `maxZoom: 21`). For Katoomba at z16 the tile range is x 60121–60140 and y 39283–39302 (400 tiles, 1.99 m/px) [V‑computed, re-checked].
  - A lower-resolution alternative, NSW SPOT 2020 (`portal.spatial.nsw.gov.au/tileservices/Hosted/Spot2020Q1/MapServer/tile/{z}/{y}/{x}`, max z17), is also used live by that app [3P].
  - WMS: `http://maps.six.nsw.gov.au/arcgis/services/public/NSW_Imagery/MapServer/WmsServer`.
  - Export: `…/NSW_Imagery/MapServer/export?bbox=150.256,-33.7549,150.364,-33.6651&bboxSR=4326&imageSR=4326&size=1024,1024&format=jpg&f=image`. Exports **above 1024 px return HTTP 500** [3P].
  - Licence: attribution is required: *"© State of New South Wales (Spatial Services, a business unit of the Department of Customer Service NSW)"* [3P]. The data is described as CC BY 4.0 [3P].
  - CORS: likely enabled (it is used directly as a MapLibre raster source) [3P]. Not verified.
- **Esri World Imagery.** `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` [K]. It is proprietary. Esri's terms require an ArcGIS account or key and restrict offline use to Esri's export-tile workflows [K]. **Online-only fallback outside NSW coverage gaps, never cached in packs** [H].

### 3.8 Canopy height

- **Meta/WRI 1 m CHM (Tolan et al. 2024) [V].**
  - Bucket prefix: `s3://dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/`, containing `chm/{quadkey}.tif`, `msk/`, `metadata/{quadkey}.geojson` (observation dates), `tiles.geojson` (15 MB index) and `CHM_acquisition_date.tif`.
    - Re-verified [V]: `tiles.geojson` is 15 167 629 bytes and `CHM_acquisition_date.tif` is 2.01 GB.
    - `metadata/311230121.geojson` alone is **45.9 MB**, so read capture dates in the pack builder, not on the phone.
  - The tile name is the **zoom-9 Bing quadkey**. Katoomba (−33.71, 150.31) → `311230121` (824 MB), which covers lat −33.724…−33.138 and lon 149.766…150.469. The valley just south (−33.735) is `311230123`, so **a 10 km Katoomba box spans two tiles** [V].
  - Format: 65 536 × 65 536 px, EPSG:3857, 1.194 m pixels (about 0.99 m on the ground at 33.7°S), uint8 metres, Deflate with predictor 2, **1-row strips (RowsPerStrip = 1), no overviews** [V].
    - Re-verified [V]: 1 IFD; Compression = 8; Predictor = 2; RowsPerStrip = 1; not tiled; size 824 738 181 bytes.
    - The quadkey is `311230121` at (−33.71, 150.31) and `311230123` at (−33.735, 150.31). The tile's southern edge is −33.7243°.
  - Reading 100 rows took 1.9 s. A 5 km window needs about 5 000 rows ≈ **60 MB** transfer (824 MB/65 536 rows ≈ 12.6 KB/row) [V‑derived].
  - **No CORS**: GET has no ACAO and the pre-flight returns 403 [V].
  - Sample: a forested 100 × 100 m block near Leura (−33.700, 150.345) read mean 7.5 m, max 16 m [V]. Treat the absolute heights of tall eucalypt forest with caution. This is a model trained on GEDI and airborne LiDAR data [K].
  - Licence: CC BY 4.0. Citation: *"Meta and World Resources Institute (WRI) – 2024. High Resolution Canopy Height Maps (CHM). Source imagery for CHM © 2016 Maxar"* [S].
- **ETH Global Canopy Height 10 m 2020** (Lang et al. 2023, *Nature Ecology & Evolution*). Data is in the ETH Research Collection (doi:10.3929/ethz-b-000609802) and on the GEE app; CC BY 4.0 [S, README]. The 3° tiles are named like WorldCover (`…_S36E150_Map.tif`) [K]. The host could not be reached. Its per-pixel standard-deviation layer is useful for flagging uncertainty.
- **TERN** (`data.tern.org.au`) hosts Australian vegetation-structure and height products [K]. Not reachable; not evaluated.

### 3.9 ESA WorldCover 10 m [V]

- URL: `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_S36E150_Map.tif`. The tile name is its **SW corner**; the tile covers lon 150…153 and lat −36…−33, and contains Katoomba.
- Format: 36 000², uint8, 1024² tiles, 6 overviews, EPSG:4326, 8.33e‑5° pixels, nodata 0, no CORS [V].
  - Re-verified [V]: 7 IFDs (36000 → 562 px). The origin is 150° E, −33° N. The file is only 20 060 792 bytes, so the whole 3° tile fits in a pack builder.
  - The ranged GET has no ACAO, and the pre-flight returns 403.
- Classes: 10 tree cover, 20 shrubland, 30 grassland, 40 cropland, 50 built-up, 60 bare/sparse, 70 snow and ice, 80 water, 90 herbaceous wetland, 95 mangroves, 100 moss and lichen [K]. A 1 km box at Katoomba read 97 % class 10, plus 30, 50 and 60 [V].
- Licence: CC BY 4.0, *"© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium"* [S; 2020 wording in the readme].

### 3.10 NSW State Vegetation Type Map (SVTM) [3P]

- Service: `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer`. Layers 0–3 are zoom-banded: 0 = PCT labels, 1 = PCT (5 m), 2 = vegetation class, 3 = vegetation formation. Layer 3 is used as a vector clip source [3P]. A WMS is at `/arcgis/services/…/WMSServer` [3P].
- Query (vector):
  ```
  …/MapServer/3/query?geometry=150.256,-33.7549,150.364,-33.6651&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultOffset=0&resultRecordCount=1000
  ```
  Page with `resultOffset` until `exceededTransferLimit` is false [K].
- **Field names (partly verified, [3P]).** The SVTM geodatabase (`SVTM_NSW_Extant_PCT_vC2_0_M2_2`) carries `PCTID`, `PCTName`, `vegForm` and `vegClass` (mwhewins/ecoTools `main.R`, 2026). Read `…/MapServer/1?f=json` once to confirm the REST names. Map `PCTID` to the AFDRS fuel type through the NSW fuel lookup table (document on fuels).
- **CAUTION — the layers may be raster, not vector [3P].** A browser app that uses this service notes *"mapserver connection doesn't seem to work — trying wms"*. The same app says *"the 4 layers show similar data, … no overlap in visibility across the zoom levels"*: layer 0 is z15–21, 1 is z13–14, 2 is z10–12 and 3 is ≤ z9.
  - If `…/3/query` fails, use `identify` or WMS `GetFeatureInfo` point queries on device.
  - In the pack builder, use the statewide **5 m PCT GeoTIFF**, `SVTM_NSW_Extant_PCT_vC2_0_M2_2_5m.tif` (about 2.3 GB, with a `.vat.dbf` attribute table) [3P] (Zen-TM/logjam `topo/CLAUDE.md`). A raster is also easier to resample onto the 10–30 m fire grid than polygons.
- **No CORS** is assumed; the project's `http.ts` routes `nswenv` through native HTTP or a proxy. There is weak contrary evidence: `mapprod3` FeatureServer/MapServer layers (GPI, wilderness) are used as esri-leaflet `featureLayer`s directly in a browser app, which needs CORS [3P]. Test on device.
- Licence: CC BY 4.0 on SEED [K].

### 3.11 NPWS Fire History (wildfires and prescribed burns) [3P]

- Service: `https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0`.
- Fields: `FireName`, `FireNo`, `FireType` (1 wildfire, 2 prescribed burn), `FireYear` (season, e.g. `201920` → 2019‑20), `Label`, `StartDate`, `EndDate`, `AreaHa`, `PerimeterM`, `NPWSBranch` and `NPWSArea`.
  - Re-verified [3P, two independent sources]:
    - The full list in uprez-net/propure-main `layers.ts` adds `OBJECTID`, `Intensity`, `OFHObjMet`, `ObjNotMet`, `VerDate` and `Shape`.
    - `FireType` 1 = Wildfire and 2 = Prescribed Burn, as coded in chulund/redbackfire-static `MapView.jsx`.
    - property-scores queries `where FireType = 1`.
  - `Intensity` and the objectives-met fields (reading "OFH" as *overall fuel hazard*: an unverified guess at the field meaning) are worth displaying for prescribed burns. A burn whose fuel-hazard objectives were "not met" should *not* be treated as a full fuel reset [H].
- Katoomba query (polygons, all types):
  ```
  https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0/query?geometry=150.256,-33.7549,150.364,-33.6651&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects&where=1%3D1&outFields=FireName,FireNo,FireType,FireYear,StartDate,EndDate,AreaHa&returnGeometry=true&f=geojson
  ```
  A canary query used by `property-scores` asserts that `max(FireYear) ≥ 201920` at Bilpin (150.532, −33.499), so the 2019‑20 fires are present [3P].
- Dates are ArcGIS epoch milliseconds when requested as JSON [K]. Use `geometryPrecision=5` and `maxAllowableOffset` (in degrees) to thin polygons.
- The **old Crown Lands fire layer froze at 2017**. Do not use it [3P].
- Coverage: NPWS estate plus the fires NPWS mapped [K]. Hazard reductions on RFS and private land may be missing. The user must be able to add "burnt in year X" manually [H].
- **RFS hazard-reduction feed** (`https://www.rfs.nsw.gov.au/funnelback/hr-map-data?collection=nsw-rfs-hazard-xml-new`) lists planned and current burns [3P] (verified: beyondtracks/nsw-rfs-geojson-feeds, *"CC BY 4.0"*).
  - A 2025–26 scraper (gangerang/bushwalkers-topo-datasets `rfs_hr_burns_data_process.py`) calls it with no parameters. It parses `results[].polygons[].polygon`, which are strings of **`lat;lon|lat;lon|…`** pairs: note the lat-first order. It also parses `leadAgency`, `lga`, `supportingAgencies`, `size` and `location`.
- **NEW — national fire history (Digital Atlas of Australia / NBIC)** [3P] (verified in ben-gy/au-bushfires `pipeline/collect.mjs`, 2026):
  - `https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/Bushfire_Boundaries_Historic_Dec_view/FeatureServer/0`: 311 984 polygons, 1899‑12‑30 → 2023‑10‑15, 7 states.
  - `…/Historical_Bushfire_Extents_2020%E2%80%9325_View/FeatureServer/3`: 2020‑07 → 2025‑06.
  - Fields are `fire_id, fire_name, ignition_date, fire_type, ignition_cause, area_ha, perim_km, state, agency`. `fire_type` includes bushfire and prescribed/planned burn strings.
  - Licence CC BY 4.0, © Commonwealth of Australia (Geoscience Australia), item `db9ae2c1d2374e20b60f26c45118f6f3`.
  - **Pitfalls reported:** multi-part fires are exploded into one row per polygon with the parent `area_ha` repeated, so never sum `area_ha`. The historic and 2020–25 layers overlap for 2020–23, so cut over at 2020‑07‑01.
  - For FireSim this fills the non-NPWS gap (RFS/Forestry fires). Rasterise the *most recent* date per cell and do not sum areas. The sandbox could not reach `services-ap1.arcgis.com`.
- **NEW — NSW FESM fire severity** (`https://mapprod3.environment.nsw.gov.au/arcgis/services/Fire/FESM/MapServer/WMSServer`, layers 1–8 = seasons 2023‑24 … 2016‑17) [3P]. It is WMS only in the evidence found. The underlying rasters are on SEED [K]. Pack-builder use: severity class per cell for the last fire.

### 3.12 DEA Sentinel-2 live fuel moisture and burnt area (bonus) [V]

- **LFMC.** Path pattern: `https://dea-public-data.s3.ap-southeast-2.amazonaws.com/derivative/ga_s2_fmc_3_v1/{UTMzone}/{band+square}/{YYYY}/{MM}/{DD}/{datatakeUTC}/ga_s2_fmc_3_v1-0-0_{tile}_{YYYY-MM-DD}_final_fmc.tif`. A STAC item sits alongside as `.stac-item.json`.
  - Katoomba is MGRS tile **56HKH**, at MGA56 E 250 708, N 6 266 749 [V‑computed].
  - Latest scenes: 2026‑09‑10 (two datatakes) [V].
  - Format: COG, 5490² (partial swaths are smaller), 20 m, EPSG:32756, int16 LFMC in %, nodata −999, 512² tiles. **CORRECTED: 5 overviews** (6 IFDs: 5490, 2745, 1373, 687, 344 and 172 px) [V]. **CORS \*** on objects **and on the bucket listing** (ListObjectsV2) [V].
    - Re-verified: the origin is E 199 980, N 6 300 040 (the 56HKH tile). A ranged GET and the pre-flight both return `ACAO: *`.
  - STAC properties include `eo:cloud_cover` and `fmask:clear`, so you can pick the clearest recent scene [V].
    - Re-verified example: the 2026‑09‑10T01:22:59 datatake has `eo:cloud_cover` 60.7 %, `fmask:clear` 32.8 % and `s2cloudless:clear` 21.7 %. So even the "latest" scene may be mostly cloud-masked over the ranges.
  - **Mountain caveat:** steep, shaded south-east-facing gully walls are affected by terrain shadow in winter Sentinel‑2 scenes (the sun is at about 29° elevation at the ~10:30 local-solar-time overpass at the June solstice at 34° S [V‑computed from standard solar geometry]). Treat LFMC pixels on slopes over ~30° facing away from the sun as low-confidence [H].
- **Burnt area (provisional).** `derivative/ga_s2_ba_provisional_3/1-6-0/56/HKH/…` holds delta-NBR/NDVI/BSI files; the latest listed folder for 56HKH is 2023 [V]. The product looks discontinued for this tile. It is not recommended.

### 3.13 Current incidents and hotspots

- **NSW RFS Major Incidents [3P].**
  - Feed: `https://www.rfs.nsw.gov.au/feeds/majorIncidents.json`, a GeoJSON FeatureCollection that was *"confirmed live 2026‑08‑26"*. It is about 69 KB, with `Cache-Control: max-age=30` [3P] (JianlingTang/wildfire-ops-copilot). Related feeds are `majorIncidentsCAP.xml`, `IncidentAlerts.xml` and `fdrToban.xml` (fire danger ratings and total fire bans).
  - Properties: `title`, `link`, `category`, `guid`, `pubDate` (e.g. `15/09/2018 9:31:00 AM`, local time) and `description`. The description is *"ALERT LEVEL: … <br />LOCATION: … <br />COUNCIL AREA: … <br />STATUS: … <br />TYPE: … <br />FIRE: … <br />SIZE: 10 ha <br />RESPONSIBLE AGENCY: … <br />UPDATED: …"*.
    - Re-verified [3P]: exxamalte/python-aio-geojson-nsw-rfs-incidents parses `pubDate` with `"%d/%m/%Y %I:%M:%S %p"`. It uses regexes `STATUS: ([^<]+) <br` and so on. `FIRE:` is `Yes`/`No`.
  - `category` values: Emergency Warning, Watch and Act, Advice, Not Applicable, Planned Burn (verified: same library, `VALID_CATEGORIES`).
  - TYPE includes "Bush Fire" and "Hazard Reduction".
  - Geometry is a **GeometryCollection**, sometimes nested, holding a Point and one or more Polygons for the fire extent. Coordinates have 14 decimals, and some extents are split into several polygons with shared borders.
  - **CORS — CORRECTED/contested:** older reports say there is no `Access-Control-Allow-Origin` (reported to RFS in 2015, still absent in 2019). A 2026 browser app (ben-gy/au-bushfires `src/live.ts`) states that RFS *"sends ACAO: \* only when an Origin header is present … Testing it with a bare curl shows no CORS header at all and looks like a dead end; it is not."* [3P]. Test with an `Origin` header before routing it through a proxy, and keep CapacitorHttp as the fallback.
  - Licence: *"© State of New South Wales (NSW Rural Fire Service) … CC BY 4.0"* (verified: exxamalte `consts.py` `ATTRIBUTION`; beyondtracks README).
  - Use the extent polygons to pre-populate the "fire is here" marking, and let the user confirm it [H].
- **Digital Atlas of Australia — Near Real-Time Bushfire Extents (NEW) [3P].**
  - URL: `https://services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/arcgis/rest/services/Near_Real_Time_Bushfire_Boundaries_view/FeatureServer/3/query?where=state%3D%27NSW%27&outFields=fire_name,fire_type,area_ha,state,agency,date_retrieved,ignition_date&geometry=150.256,-33.7549,150.364,-33.6651&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&f=geojson`.
  - It is national, refreshed roughly every 3 hours, and reported **CORS `*`** (ben-gy/au-bushfires, ODIN-fire/odin-rs, mapollc; ArcGIS item `8b28109ce26b43b8968a3c9baa608f43`). Licence CC BY 4.0.
  - This is the cleanest browser-callable fire-extent source. Use it as a second opinion to the RFS polygons. It is blocked from the sandbox, so field names come from three client codebases.
- **DEA Hotspots [S, 3P].**
  - WFS: `https://hotspots.dea.ga.gov.au/geoserver/public/wfs` (WFS 1.1.0; outputs GeoJSON, CSV, KML and SHAPE‑ZIP), no auth, CC BY 4.0. Data runs from 27 Aug 2002, updated every 10 minutes (verified: dea-knowledge-hub `_data.yaml`). The KML covers the last 3 days, and there is a `…/data/recent-hotspots.json` GeoJSON (3 days).
    - **WARNING:** that file is about **149 MB** (156 537 355 bytes, 175 286 features for all of Australia) and took about 680 MB of RAM to parse [3P] (JianlingTang/wildfire-ops-copilot). Never fetch it on a phone. Its property names include `datetime`, `sensor`, `confidence`, `australian_state` and `temp_kelvin` [3P].
  - A WMS mosaic of Himawari‑9 imagery, `public:himawari9_mosaic`, is also served [3P]. It can show a smoke plume's direction as an independent check on the wind.
  - Layers: `public:hotspots`, `public:hotspots_three_days`, `public:satellite_pass_last_hotspot` and `public:satellite_pass_next_hotspot`.
  - Katoomba query, 24 h. CQL POLYGON coordinates are in **lat lon** order, as in working code:
    ```
    https://hotspots.dea.ga.gov.au/geoserver/public/wfs?service=WFS&version=1.1.0&request=GetFeature&typeName=public:hotspots_three_days&outputFormat=application/json&CQL_FILTER=INTERSECTS(location,%20POLYGON((-33.6651%20150.256,%20-33.6651%20150.364,%20-33.7549%20150.364,%20-33.7549%20150.256,%20-33.6651%20150.256)))&maxFeatures=500
    ```
  - Properties seen in client code: `datetime`, `start_dt`, `satellite`, `sensor`, `product`, `confidence` and FRP (`power`) [3P]. Verify them with `DescribeFeatureType`. The service can be slow [3P]. CORS is unknown, so use native HTTP.
- **NASA FIRMS [3P].**
  - Endpoint: `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{DAY_RANGE}[/{YYYY-MM-DD}]`, for example:
    ```
    https://firms.modaps.eosdis.nasa.gov/api/area/csv/<KEY>/VIIRS_NOAA20_NRT/150.2,-33.8,150.4,-33.6/1
    ```
  - Sources: `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT` and `MODIS_NRT`.
  - `DAY_RANGE` must be 1–5. Anything else returns *"Invalid day range. Expects [1..5]."* (verified by three independent 2026 repos: ArceusDesign/bali-air-dispatch, krishnasharma1493/IGNISSENSE, Escherbridge/plantgeo).
    - **CORRECTED:** the HTTP status is reported as **200** by one repo and **400** by two others. Detect the error from the body text, not from the status code.
    - `DAY_RANGE=1` means the current UTC day, which is nearly empty just after 00Z; use 2 and filter.
  - Limit: 5 000 transactions per 10 minutes per MAP_KEY. The key is free (`/api/map_key/`).
  - Licence: NASA open data with attribution [K]. Do not ship a shared key in the app; either ask the user for a key or use DEA Hotspots, which needs none [H].

---

## 4. Equations, formulas and constants (with units and sources)

| # | Quantity | Formula | Units / valid range | Source |
|---|---|---|---|---|
| E1 | Terrarium decode | `h = R·256 + G + B/256 − 32768` | m; 1/256 m precision. **CORRECTED:** −11 000 m = rgb(85, 8, 0) and +8 900 m = rgb(162, **196**, 0); the earlier (162, 198, 0) decodes to 8 902 m | (verified: Tilezen Joerd `docs/formats.md`; live decode 1021 m at Katoomba z12 [V]) |
| E2 | Terrarium encode | `v' = v + 32768; R = ⌊v'/256⌋; G = ⌊v' mod 256⌋; B = ⌊(v' − ⌊v'⌋)·256⌋` | — | (verified: Joerd `formats.md`, verbatim) |
| E3 | Mapbox Terrain-DEM decode | `h = −10000 + 0.1·(R·65536 + G·256 + B)` | m; 0.1 m steps | third-party implementations (2025–26) [3P]; matches Mapbox's published formula as far as the fact-checker knows (UNVERIFIED — docs.mapbox.com blocked) |
| E4 | Slippy tile index | `x = ⌊(λ+180)/360 · 2^z⌋`, `y = ⌊(1 − asinh(tan φ)/π)/2 · 2^z⌋` | λ, φ in degrees; valid for \|φ\| < 85.0511° | OSM "Slippy map tilenames" [K]; (verified: recomputed z12/14/15/16 indices for Katoomba = 3758/2455, 15032/9823, 30065/19646, 60131/39292, and the tiles decode to the right place [V]) |
| E5 | Web-Mercator ground resolution | `res = cos φ · 2π·6378137 / (256·2^z)` | m px⁻¹ (ground). Web-Mercator *projected* metres are larger by 1/cos φ (1.202 at 33.7° S), so EPSG:3857 bboxes must be enlarged accordingly | (verified: Joerd `data-sources.md`, verbatim) |
| E6 | Quadkey (Meta CHM tile) | for i = z…1: `digit = bit_{i−1}(x) + 2·bit_{i−1}(y)`, most significant bit first | z = 9 | Bing Maps Tile System [K]; (verified: recomputed `311230121` and `311230123`; both objects exist [V]) |
| E7 | Open-Meteo elevation shift | `X_target = X_model + (z_model − z_target)·0.0065` for every variable with `isElevationCorrectable` **and** unit °C | K (°C). **CORRECTED:** not T‑only. `ecmwf_ifs` also shifts `dew_point_2m`, T max/min, surface and soil T; ICON also shifts T at 80/120/180 m; GFS also shifts T at 80/100 m. Never applied to wind, RH (native), pressure levels | (verified: `GenericReader.swift` `scale()`; `EcmwfEcpdsVariable.swift`, `IconVariable.swift`, `GfsVariable.swift`) |
| E8 | Open-Meteo call weight | `w = Σ_loc max(1, max(nV·nM/10, (T/14)·nV·nM/10))` | calls. T = days in the whole requested range, including `past_days`. Free limits 600/min, 5 000/h, 10 000/day, 300 000/month | (verified: server `ForecastApiResult.calculateQueryWeight()` and the website pricing calculator) |
| E9 | Saturation vapour pressure (Magnus, over water) | `e_s(T) = 6.112·exp(17.62·T/(243.12+T))` | hPa; T in °C; −45…60 °C | WMO CIMO Guide (WMO‑No. 8), Annex 4.B [K] (UNVERIFIED against the WMO PDF, which is blocked; the constants are the widely-cited WMO/Sonntag Magnus set). **Consistency note:** Open-Meteo itself uses β = 17.625, λ = 243.04 °C (Alduchov & Eskridge 1996 form) to convert T/T_d ↔ RH, and the FAO‑56 Tetens form `0.6108·exp(17.27T/(T+237.3))` kPa for VPD (verified: `Meteorology.swift`). Document 02 uses Bolton (17.67, 243.5). The differences are < 0.2 °C in T_d over the fire-weather range, but pick **one** set app-wide |
| E10 | RH from T and T_d | `RH = 100·e_s(T_d)/e_s(T)` | % (clamped 0–100) | follows from E9 (verified: identical structure to Open-Meteo `relativeHumidity()`) |
| E11 | Vapour pressure deficit | `VPD = e_s(T) − e_s(T_d) = e_s(T)·(1 − RH/100)` | kPa (divide hPa by 10); Open-Meteo `vapour_pressure_deficit` is in kPa and computed from T and T_d with FAO‑56 constants, clamped ≥ 0 | (verified: `Meteorology.vaporPressureDeficit`, unit `.kilopascal`) |
| E12 | Wind components | `u = −V·sin θ`, `v = −V·cos θ` (θ = direction the wind blows *from*, clockwise from north); inverse `V = √(u²+v²)`, `θ = atan2(−u, −v)` mod 360° | m s⁻¹ | standard meteorological convention [K] (consistent with Open-Meteo storing U/V and deriving speed and direction) |
| E13 | Log wind profile (neutral) | `U(z) = (u*/κ)·ln((z−d)/z₀)`, κ ≈ 0.40 | m s⁻¹; neutral surface layer only, which is roughly the lowest ~10 % of the boundary layer [K]. It is not valid in the lee of steep ridges and cliff lines, where the flow separates | Stull 1988 [K] (UNVERIFIED — book not fetched; the equation is textbook-standard) |
| E14 | Horn slope | `∂z/∂x = [(c+2f+i) − (a+2d+g)]/(8Δx)`, `∂z/∂y = [(g+2h+i) − (a+2b+c)]/(8Δy)`, `S = atan√(∂z/∂x² + ∂z/∂y²)` | degrees; 3×3 window a…i in row order, north row first, so this ∂z/∂y is positive *southwards*. Flip its sign before computing aspect | Horn 1981 [K]; (verified: re-implemented and reproduced the §2.1 table [V]) |
| E15 | Olson fuel accumulation | `w(t) = w_ss·(1 − e^{−k t})`; after a partial burn, `w(t) = w_ss(1 − e^{−kt}) + w₀e^{−kt}` | t ha⁻¹; t in years since fire; k yr⁻¹ | Olson 1963 [K]; (verified: consistent with document 05 and the PyroXL `AFDRS_General.bas` `fuel_amount` formula quoted there) |
| E16 | McArthur slope factor (context) | upslope `SF = exp(0.069 θ) ≈ 2^{θ/10}` (doubles per 10°); **downslope** use the kataburn form `SF(−θ) = SF(θ)/(2·SF(θ) − 1)`, which never falls below 0.5 | θ in degrees. Commonly applied up to ~20° [K]; beyond ~20–25° it extrapolates, and eruptive/attached-plume behaviour (document 01) takes over | Noble et al. 1980 [K]; kataburn (Sullivan et al. 2014) (verified: both forms as recorded and source-checked in document 01) |
| E17 | Pack imagery size | `N_tiles(z) = (x₁−x₀+1)(y₁−y₀+1)`; Katoomba 10 km: z15 121, z16 400, z17 1 600, z18 6 241 | tiles | (verified: recomputed [V]) |
| E18 | MGRS tile | UTM zone `⌊(λ+180)/6⌋+1`; 100 km column/row letters from E and N | — | (verified: Katoomba = zone 56, E ≈ 250.7 km → column K, N mod 2 000 km ≈ 266.7 km → row H ⇒ **56HKH**, matching the DEA path [V]) |
| E19 | Open-Meteo height scaling of wind (NEW) | `U(z₂) = U(z₁)·f(z₁)/f(z₂)` with `f(z) = 4.87/ln(67.8 z − 5.42)`, i.e. `U(z₂) = U(z₁)·ln(67.8 z₂ − 5.42)/ln(67.8 z₁ − 5.42)` | z in m. Example: 100 → 120 m multiplies by 1.021. This is the FAO‑56 log conversion. IFS 80/120 m winds are this factor × the 100 m wind, and 180 m is scaled from 200 m. So they are **not** independent model levels; do not fit a profile through them | (verified: `Meteorology.scaleWindFactor`; `EcmwfEcpdsReader.swift`) |

---

## 5. Implementation recommendations

### 5.1 Transport and threading (fits the existing `src/data/http.ts`)

- **Main thread fetches, the worker computes.** Capacitor's native bridge exists only in the WebView's main context. Fetch inside a Web Worker is **not** patched, and non-CORS services fail there. `http.ts` already says so [S]. The scenario builder on the main thread fetches everything, decodes it (PNG, GeoTIFF), assembles `ScenarioData` typed arrays and `postMessage`s them to the worker **as transferables**, so there is no copying.
- **Binary over the bridge.**
  - `CapacitorHttp` returns binary data as base64. That adds about 33 % size overhead and a decode step [S, from the `@capacitor/core` 8.5 types and our `http.ts` notes].
  - For **large files** (area packs, CHM chunks), stream to disk with progress events, then read the file in slices.
    - **CORRECTED:** `Filesystem.downloadFile({url, path, directory, progress:true})` exists in `@capacitor/filesystem` 8.1.3 but is **deprecated since 7.1.0**: *"@deprecated Use the @capacitor/file-transfer plugin instead"* (verified: installed `dist/esm/definitions.d.ts`).
    - Add `@capacitor/file-transfer` for new code; the plugin is not yet in `package.json`.
- **GeoTIFF range reads on device.** `geotiff.js` `fromCustomClient` with a client that calls `CapacitorHttp` with a `Range` header. This works for the GA DEM, WorldCover and DEA LFMC. For CORS-enabled COGs (GA DEM, DEA LFMC, Terrarium), a PWA or browser build can read directly [V].
- **WebGL textures.** Fetch imagery bytes, then `createImageBitmap(new Blob([bytes]))`, then `THREE.Texture`. Do not set `img.src` to a remote URL for services whose CORS is unknown [K].
- **Etiquette.**
  - Send an honest `User-Agent` such as `FireSim/<ver> (+contact)`. ArcGIS services throttle or deny requests without a UA under load [3P].
  - Allow at most 4 concurrent requests per host, with exponential back-off on 429/5xx.
  - Cache every response with its `fetchedAt` time and source.

### 5.2 Layer priority and fallbacks (per scenario build)

| Layer | 1st | 2nd | 3rd | Fallback |
|---|---|---|---|---|
| Fire-grid DEM (10–30 m) | NSW 5 m ImageServer, aggregate by block mean | GA DEM 1″ COG (bare earth) | Terrarium z12 (SRTM 1″) | bundled demo terrain or synthetic |
| Atmosphere DEM (100–200 m) | the fire DEM, low-pass filtered (e.g. Gaussian σ ≈ 1 cell), and slope-limited [H] | — | — | — |
| Canopy height and cover | pack (pre-processed Meta CHM → 10 m p90 height, mean, cover ≥ 2 m) | ETH 10 m | WorldCover class → default heights | fuel-type defaults |
| Vegetation type | SVTM PCT → AFDRS fuel type | WorldCover class | terrain-rule inference (`inferFuelTypes`) | user paint |
| Fire history | NPWS polygons → time since fire, last type, count | RFS HR feed and incident polygons | user "burnt in year X" | "long unburnt" default flagged as an assumption |
| Live FMC | DEA S2 LFMC, clearest scene within 20 days | seasonal default | — | user slider |
| Weather (surface) | Open-Meteo `ecmwf_ifs` (9 km: T, T_d, 10/100/200 m wind, PBL, CAPE) | `dwd_icon_global` | `ncep_gfs_global` | presets / belt-weather kit entry |
| Weather (profile) | **CORRECTED:** `ncep_gfs_global` pressure levels (0.25°, hourly, 25 hPa steps near ridge height) | `ecmwf_ifs025` (3-hourly, 1000/925/850/700) | `dwd_icon_global` levels | standard-atmosphere profile + user inversion |
| Observations | BoM nearest AWS (user tap) | user belt-kit reading | — | — |
| Incidents | RFS majorIncidents polygons | Digital Atlas near-real-time extents (CORS \*) | DEA Hotspots (3 days, bbox WFS only), FIRMS (user key) | user marks fire |
| Fire history | NPWS polygons | Digital Atlas national historical boundaries + RFS HR feed | FESM severity as a modifier | user "burnt in year X" |

### 5.3 Weather ingestion and downscaling to the 3-D grid

1. **Request.** Make one call per model, with `elevation=nan`:
   - (A) for the ECMWF 9 km surface;
   - (B) for the ECMWF 0.25° profile, now `ecmwf_ifs025`;
   - (C) for the GFS profile.

   Set `forecast_days` to the scenario length; ≤ 3 days is plenty for a 2–6 h run. Keep `past_days` short (≥ 3 days for dead-FMC spin-up) on the profile calls, because of the E8 time weight. Fetch the 92-day drought history as a separate single-point, few-variable daily request. Cache the raw JSON.
   - **Check every returned array for all-`null`** before use; a wrong model/variable pairing is silent.
2. **Vertical profile at time t.**
   - Take the pressure levels with `geopotential_height_<L>hPa` (m MSL) and interpolate T, RH (via T_d and E9/E10) and u, v (E12) linearly in `ln p` or in height onto the 20–30 atmosphere levels up to about 3 km.
   - Near-surface layers (terrain height + 10…200 m) come from the 10/80/100/120/180/200 m winds and 2 m T/RH, blended with E13. Only the *native* heights are independent: IFS 10/100/200 m, GFS 10/80/100 m, ICON 10/80/120/180 m. The rest are E19-scaled copies.
   - **Discard pressure levels that lie below the model's own ground.** Check `geopotential_height_<L>hPa` against the grid-cell elevation. On the Blue Mountains plateau 1000 hPa is usually underground, and at Kosciuszko 850 hPa is too. Those values are extrapolated fiction.
   - Below the lowest pressure level above ground, as happens in valleys, extrapolate using the model's 2 m values rather than the 0.0065 K/m standard lapse rate [H].
   - The model's 2 m values sit at the *grid-cell mean* height. Assign them to that height, not to the valley floor or the ridge.
     - For scale [V‑computed from SRTM], a 9 km box centred on Katoomba has mean elevation **836 m** (range 226–1080 m), and a 25 km box **701 m** (127–1116 m).
     - So the model surface over Katoomba is ~200 m *below* the town ridge (~1 020 m) and several hundred metres *above* the valley floors. The box minimum is 226 m.
     - The actual model orography differs from these box means; read it from an `elevation=nan` response.
3. **Terrain-following initial state.**
   - Initialise each column from the profile at its own height (z = terrain + η).
   - At night and at dawn, apply a **cold-pool option**: a stable layer of configurable depth and strength over valley floors (document 02). By day, apply a well-mixed boundary layer up to `boundary_layer_height` [H].
   - The user can override any of these from the belt-weather kit.
4. **Nudging to observations.** If the user fetches a BoM AWS reading or enters belt-kit readings, shift the surface layer (T, T_d, wind) toward the observation with a Gaussian weight in horizontal distance (radius ~5 km) and height (~200 m) [H]. The weather card shows both "model" and "observed".
5. **Time interpolation.**
   - Interpolate hourly values linearly: wind as vectors, RH via T_d.
   - Radiation is the mean over the preceding hour, so assign it to the middle of that hour.
   - Gusts are the maximum over the preceding hour, so use them only for the gust factor, not the mean wind.
6. **Budget.** Parsing 3 models × 7 days × about 60 variables of JSON is about 1–2 MB and takes < 100 ms on a phone [K]. That is negligible against the 1–2 minute simulation budget.

### 5.4 Terrain and fuel preprocessing on device

- **DEM.** For the 5 m ImageServer, request 4 × 4 chunks of 500 × 500 px Float32 (1 MB each). Mosaic them and block-average to the fire cell (10 m = 2 × 2, 30 m = 6 × 6). Also compute the within-cell maximum slope, so a cell can be flagged "contains cliff". The insight cards use this, and the fire model can use it for barrier and spotting logic [H].
- **Slope/aspect.** Apply Horn (E14) on the fire grid, and again on the smoothed atmosphere DEM. Store both. The insight engine should use fire-grid slope.
- **Canopy (Meta CHM).** Do this in the pack builder, not live: 5 000 row requests, about 60 MB per 5 km, across two tiles at Katoomba. Output a 10 m raster of p90 height (uint8), mean height (uint8) and cover fraction (uint8 × 255), in the same format as the demo `canopy.png` [S, `src/data/canopy.ts`].
- **SVTM, NPWS and RFS polygons.** Clip to the bbox. Rasterise to the fire grid with a polygon scan-line fill. Keep the vectors, simplified to 5 m, in the pack for display.

### 5.5 Offline area packs (strategy)

**Why.** Fire grounds in the Blue Mountains, Wollemi, Kanangra‑Boyd and Kosciuszko often lack coverage [K]. Everything the simulation needs must be downloadable in advance over Wi-Fi.

**Pack contents, 10 km × 10 km (sizes estimated from verified formats [V‑derived]):**

| Item | Resolution / format | Size (approx.) |
|---|---|---|
| DEM (NSW 5 m → 10 m Float32, or int16 decimetres + deflate) | 1000 × 1000 | 1.5–4 MB |
| SRTM fallback (Terrarium z12 tiles) | 4 tiles | 0.2 MB |
| Imagery NSW z16 JPEG (+ z13–15 overview pyramid) | 400 + ~130 tiles | 10–15 MB (z17 adds ~40 MB, optional) |
| Canopy p90/mean/cover | 10 m, PNG | 1–2 MB |
| WorldCover | 10 m uint8 | < 0.5 MB |
| SVTM PCT raster + simplified vectors | 10 m uint16 + GeoJSON | 1–5 MB |
| NPWS fire history polygons + time-since-fire raster | GeoJSON + 10 m | < 1 MB |
| **NEW:** Digital Atlas national fire history (non-NPWS fires) + FESM last-fire severity class | 10 m uint8/uint16 rasters | < 1 MB |
| **NEW:** Upwind terrain halo for the atmosphere grid (GA DEM‑S, 30 × 30 km at 180 m) | 167 × 167 Float32 | ≈ 0.1 MB |
| DEA LFMC latest clear scene (clipped) | 20 m int16 | < 0.5 MB |
| Weather: `past_days=92` daily (few variables, 1 point) + 7 days hourly + 15–16 days forecast (IFS 15 d, GFS 16 d, ICON 7.5 d), 3 models | JSON | 0.3–1 MB |
| Manifest: bbox, created, per-layer source, licence, attribution text, expiry | JSON | < 10 KB |
| **Total** | | **≈ 15–40 MB** |

**Rules:**

- **Two ways to build a pack [H].**
  - **On device:** DEM, WorldCover, LFMC, fire history, incidents and weather are all feasible live.
  - **Pack builder (script or CI):** pre-builds packs for the listed NSW mountain regions, including the CHM and SVTM rasterisation, and publishes them as static files. A static-file CDN is enough for area packs. The licences allow this because every layer is CC BY 4.0 or public domain; exclude BoM, Esri and Mapbox. The manifest carries all required attribution strings.
- **Freshness.**
  - Terrain, canopy, vegetation and land cover: no expiry. Show the capture date: Meta CHM uses its `metadata` geojson, WorldCover is 2021.
  - Fire history: refresh each season. Show "history current to <date>".
  - Weather: stale after 6 h (forecast) or 24 h (past). When stale, show "Using forecast issued <time>, <n> h old" and invite belt-kit entry.
  - Incidents and hotspots: **never offline-authoritative**. Display the fetch time in large type.
- **Storage.**
  - Put large rasters in the Capacitor `Filesystem` `Directory.Data` directory, so they are not evicted like `Cache` [K]. Put the index and small JSON in IndexedDB (existing `cache.ts`).
  - Show the per-pack size and a delete button. Warn above 500 MB total [H].
- **Pre-download UI.** "Download area for offline" draws a 10 km square (5, 10 or 20 km options) around the current location or a map pick. Estimate the size first using E17 and the table above.
- **Why a terrain halo (mountain-specific) [H].** Airflow entering a 10 km domain has already been shaped by the ranges upwind. Examples: the Great Dividing Range crest west of Katoomba under a hot north-westerly, and the Snowy main range upwind of Thredbo. A coarse 30 km halo costs almost nothing and lets the atmosphere model's inflow "feel" upwind ridges and valleys. Without it, a pre-frontal NW wind enters the domain as if it came off flat ground.

### 5.6 What the user should be able to edit (data layer)

- **Location and extent:** centre, domain size 3–10 km, fire cell 10/20/30 m.
- **Weather:**
  - model choice, and "use observed" (BoM or belt kit);
  - surface T, RH or T_d, wind speed and direction at 10 m;
  - the time-offset to a forecast hour;
  - inversion or cold-pool depth and strength;
  - mixing height.
- **Fuel:** fuel type paint; time since fire, where "last burnt: year / wildfire or HR" overrides NPWS; **last-fire severity** (low / patchy / canopy-scorch, pre-filled from FESM) and "HR objectives met?" (pre-filled from NPWS where populated); surface, near-surface and elevated hazard and bark sliders; live FMC.
- **Weather provenance:** which model supplied the surface fields (`ecmwf_ifs`) and which supplied the profile (GFS or `ecmwf_ifs025`). Show both grid sizes, so the user sees "25 km profile, 9 km surface" [H].
- **Fire:** mark the ignition or fire line (pre-filled from RFS polygons or hotspots); mark "fire jumped here" spot fires.
- **Data provenance panel:** each layer's source, date and licence, and whether it came from a pack or live.

---

## 6. Explaining it to a beginner firefighter (insight cards tied to data)

These cards explain **what the data can and cannot tell you**. All thresholds are **[H] FireSim design values** unless a source is given, and they are tunable in config.

| Card | Detection criterion | Text |
|---|---|---|
| **"The forecast sees a smoother mountain"** | the site's DEM elevation differs from the model grid-cell height by more than 150 m, **or** the local DEM relief (max − min) within 5 km is more than 300 m [H]. Get the grid-cell height from the `elevation` returned by an `elevation=nan` request (the docs say the grid-cell average is then used; that it is echoed is unverified), or from the SRTM mean over the model cell. Katoomba triggers both: the 9 km box mean is 836 m against a town at 1 020 m, and the box spans 226–1 080 m [V‑computed from SRTM] | "The weather forecast is for a 9 km square. It can't see this valley. Up on the ridge it may be windier and drier. Down in the gully it may be calmer and cooler at night. Check with your belt-weather kit." |
| **"Why your valley may be colder tonight"** | local time 18:00–09:00, 10 m wind < 3 m s⁻¹, cloud_cover < 30 %, and the site is in the lowest third of domain elevations [H] | "On clear, calm nights cold air drains downhill and pools in valleys. The forecast's standard temperature correction assumes it always gets cooler as you go up. Tonight the valley floor may be colder and damper than the ridge." (document 02) |
| **"Dry air waiting upstairs"** | `relative_humidity_700hPa` or `_850hPa` < 25 % (from `ecmwf_ifs025` or GFS, **not** `ecmwf_ifs`, which has no levels), `boundary_layer_height` (from `ecmwf_ifs` or GFS) rising above the ridge height by 12:00–15:00, and surface RH > 35 % [H]. Only use levels that lie above the model ground (§5.3) | "Very dry air sits above us. When the sun heats the ground, the air mixes deeper and can bring that dry air down onto the ridge. Humidity can fall fast in the early afternoon." |
| **"Observed vs forecast"** | a BoM AWS or belt-kit reading differs from the model by more than 5 °C in T, more than 15 percentage points in RH, or more than 30° and more than 3 m s⁻¹ in wind [H] | "The nearest weather station disagrees with the forecast (station 14 % RH vs forecast 25 %). FireSim is now using the station's value near the ground." |
| **"Steep ground the map can blur"** | the within-cell max slope from the 5 m DEM exceeds the fire-cell slope by more than 15°, or cliff cells are present (max slope > 45°) [H]. For scale: at Katoomba, 3.3 % of 30 m cells exceed 40°, and only 0.4 % at 180 m (§2.1, verified) | "There's a cliff or very steep bank here. Fire runs much faster uphill, roughly doubling for each 10° of slope (McArthur rule, E16). Going downhill it slows, but only to about half speed. Cliffs can also throw embers well out ahead and act as launch ramps for the plume." |
| **"Coarse terrain in use"** | the DEM source is SRTM or GA 1″ because the 5 m source is not available [H] | "We're using 30 m satellite terrain. Small gullies and cliffs are smoothed out, so the real slopes are steeper than shown." |
| **"Old fuel here"** | NPWS time since fire > 15 years, or no record [H]; fuel-accumulation rationale from Olson (E15) | "No fire recorded here for 15+ years. Leaf litter and bark have had time to build up, so expect a hotter fire and more embers." |
| **"Recent burn, but not fireproof"** | FireType = 2 (prescribed burn) within 0–3 years [H] | "This area was hazard-reduced in 2024. That reduces the ground fuel, but shrubs and stringy bark can still carry fire and embers on a bad day." |
| **"Plants are thirsty"** | DEA LFMC median in the domain < 80 % from a scene less than 20 days old [H] | "Satellite data shows the living plants are dry (about 70 % moisture). Dry shrubs catch and carry fire more easily." |
| **"Hotspot is approximate"** | a hotspot is shown | "A satellite saw heat somewhere in this box (about 400 m to 1 km across for VIIRS or MODIS, 2 km or more for Himawari), at <time>. It is not the exact fire edge, and the fire has probably moved since. On a steep slope the dot can be off by a pixel or more." |
| **"Data is old"** | forecast more than 6 h old, or incidents more than 30 min old, when offline | "You're offline. This weather is from <time>, <n> hours ago. Enter your own belt-weather readings to update the simulation." |
| **"The ridge-top wind is stronger than the forecast says" (NEW)** | the site is on a ridge or plateau edge: topographic position index (site minus the 500 m-radius mean DEM height) > +40 m. **And** the wind at the first pressure level above the local ground (GFS 25 hPa levels), or the 100/200 m wind, is > 1.5 × the 10 m forecast wind [H] | "The forecast's 10 m wind is for a smoothed hill that sits lower than this ridge. Up here you're closer to the faster air above, and wind speeds up as it's squeezed over a crest. Expect stronger, gustier wind on the ridge than the forecast number, and faster fire runs across it." |
| **"This weather station is on a ridge" (NEW)** | a nearest BoM AWS is shown, and its altitude is more than 200 m above the local valley floor (the minimum DEM height within 3 km of the fire) [H] | "Katoomba and Mount Boyce stations sit at 1 017 m and 1 080 m, on the plateau. At night the valley below can be much colder, calmer and damper. By afternoon it can be hotter, with wind funnelled up the gully. Use your own belt-weather reading for the valley." |
| **"Forecast layers under the ground" (NEW)** | any requested pressure level has `geopotential_height_<L>hPa` below the model ground or the site DEM height (e.g. 1000 hPa over the Blue Mountains, 850 hPa at Kosciuszko) [H] | "Some of the forecast's upper-air layers are actually below this mountain, so FireSim ignores them. Here, 'above us' starts at the next layer up." |
| **"Last fire here was severe — thick regrowth" (NEW)** | FESM severity class high or extreme for the most recent fire, 2–10 years ago [H] | "The last fire burnt the canopy here. Burnt forests often come back as dense young shrubs and saplings. That's lots of fuel off the ground that can carry flames up into the trees, even though the leaf litter is still thin." |
| **"Burn didn't meet its target" (NEW)** | NPWS `FireType = 2` with `ObjNotMet` populated, or `OFHObjMet` = no (field semantics UNVERIFIED — read the domain values first) [H] | "A hazard-reduction burn was done here, but its fuel-reduction goal wasn't fully reached. Don't assume the fuel is gone. Patches may never have burnt." |
| **"Fire history may be incomplete" (NEW)** | the site is outside NPWS estate, or no NPWS or Digital Atlas record exists within 1 km [H] | "No burn is recorded here, but that doesn't prove it hasn't burnt. The maps mostly cover national parks and large fires. If you know it was burnt, set the year and FireSim will update the fuel." |

Every card has a **"Where does this come from?"** link to the provenance panel (§5.6) and cites the source layer.

---

## 7. Open questions and uncertainties

1. **CORS for NSW services.** `maps.six.nsw.gov.au` (5 m DEM, imagery) and `mapprod3.environment.nsw.gov.au` (SVTM, NPWS, FESM) could not be tested. We route both through native HTTP. Test them on device and in the PWA.
   - There is weak evidence that `mapprod3` FeatureServers answer browser XHR, since esri-leaflet `featureLayer`s are used live. There is also evidence that the SVTM MapServer does *not* work that way, so that app fell back to WMS.
2. **NSW 5 m DEM provenance and limits.**
   - Two 2026 third parties disagree on whether it is LiDAR or photogrammetry (§3.5). This is the **most important open terrain question**, because it decides whether forested-gully slopes are bare-earth.
   - The reported `maxImageWidth/Height` are 15 000/4 100 [3P].
   - The cold latency (~28 s reported) and any throttling for pack-building bursts still need checking. Read `…/ImageServer?f=json`. If bulk extraction is heavy, ask NSW Spatial Services about the preferred bulk route (ELVIS downloads; a third party counted about 81 000 NSW 5 m tiles, 50.5 GB, in ELVIS [3P]).
3. **GA 5 m LiDAR mosaic coverage** over the Blue Mountains, Barrington and Kosciuszko is not verified. The zone 56 file is `nationalz56_ag.zip`, 10.61 GB, holding one GeoTIFF from 2021 [V].
4. **SVTM REST field names and whether layers 0–3 are raster or vector** need a `?f=json` read. The gdb fields are `PCTID`, `PCTName`, `vegForm` and `vegClass` [3P].
5. **Open-Meteo, now resolved from source [S]:**
   - Multi-model keys get the suffix `_<model>`.
   - Unavailable variables come back as `null` arrays with unit `undefined`.
   - IFS HRES has **no** pressure levels at any date. IFS 0.25° levels start 2024‑02‑03 in the Historical Forecast API, and GFS levels 2021‑03‑23.
   - Still open: whether an `elevation=nan` response echoes the grid-cell height in `elevation`.
6. **BoM copyright default terms** are unread. The status of the `fwo` JSON after BoM's platform upgrade is reported live in Aug 2026 [3P] but should be re-checked. BoM open data to Open-Meteo is "temporarily suspended" [S].
   - BoM's gridded ADFD forecasts, including fire-weather grids, reportedly exist on the anonymous FTP [K, UNVERIFIED]. FTP is not callable from CapacitorHttp, so these would be pack-builder only.
7. **DEA Hotspots** WFS property names and CORS need a `DescribeFeatureType` read and a test. The GeoJSON dump fields are `datetime`, `sensor`, `confidence`, `australian_state` and `temp_kelvin` [3P].
8. **Meta CHM accuracy in tall NSW eucalypt forest.** Sample values (mean 7.5 m, max 16 m near Leura) look low for the upper Blue Mountains' tall open forest [K]. Validate against NSW LiDAR-derived canopy heights before relying on absolute heights.
9. **Esri and Mapbox terms** were not re-read this session. Both are excluded from packs as a precaution.
10. **RFS CORS (NEW).** The 2026 report of `ACAO: *` when `Origin` is present contradicts 2015–2019 reports. Test with a browser `fetch` before routing it through a proxy.
11. **Digital Atlas services (NEW)** (`services-ap1.arcgis.com/ypkPEy1AmwPKGNNv/…`) were blocked from the sandbox. Field names and CORS come from three independent client codebases [3P].
12. **FESM severity classes and NPWS `Intensity`/`OFHObjMet`/`ObjNotMet` domains (NEW)** need a `?f=json` read before any insight card relies on them.
13. **Humidity constants (NEW).** Across documents 02, 04 and 08 and Open-Meteo there are several Magnus/Tetens constant sets: Bolton 17.67/243.5, WMO 17.62/243.12, Alduchov–Eskridge 17.625/243.04 and FAO‑56 17.27/237.3. Standardise on one in code; the differences are < 0.2 °C in T_d.

---

## 8. References

**Weather**
- Open-Meteo. *Weather Forecast API docs* (source of https://open-meteo.com/en/docs), including per-model pages `ecmwf-api`, `gfs-api`, `dwd-api` and `bom-api`. https://github.com/open-meteo/open-meteo-website/tree/main/src/routes/en/docs (read 2026‑09‑27).
- Open-Meteo. *Historical Forecast API*, *Single Runs API*, *Historical Weather API*: https://open-meteo.com/en/docs/historical-forecast-api ; https://open-meteo.com/en/docs/single-runs-api ; https://open-meteo.com/en/docs/historical-weather-api .
- Open-Meteo. *Terms*, *Licence* and *Pricing* (call-weight formula): https://open-meteo.com/en/terms ; https://open-meteo.com/en/licence ; https://open-meteo.com/en/pricing .
- Open-Meteo server source: `Sources/App/configure.swift` (CORS), `Sources/App/Helper/Reader/GenericReader.swift` (0.0065 K/m correction). https://github.com/open-meteo/open-meteo .
  - Fact-check additions (commit `cc3f4e5`, 2026‑09‑23):
    - `Sources/App/EcmwfEcpds/EcmwfEcpdsVariable.swift`: the IFS HRES 9 km variable list (no pressure levels) and `isElevationCorrectable`.
    - `Sources/App/Ecmwf/EcmwfVariable.swift`: IFS/AIFS 0.25° pressure levels.
    - `Sources/App/Icon/Icon.swift`: ICON levels.
    - `Sources/App/Gfs/GfsVariable.swift`: GFS levels and correction flags.
    - `Sources/App/Bom/BomVariable.swift`.
    - `Sources/App/Helper/Writer/ForecastApiResult.swift`: `calculateQueryWeight`, and the multi-model key suffix.
    - `Sources/App/Helper/Meteorology.swift`: RH/T_d/VPD constants and `scaleWindFactor`.
    - `Sources/App/Controllers/ForecastapiController.swift`: `past_days` window and the NaN fill.
  - Website docs commit `5cc7ca6` (2026‑09‑24): `src/routes/en/docs/{ecmwf-api,gfs-api,dwd-api,bom-api,historical-forecast-api,historical-weather-api,single-runs-api}/`, `pricing/`, `terms/` and `licence/`.
- FAO (1998). *Crop evapotranspiration* (FAO Irrigation and Drainage Paper 56), Eq. 47 (wind height conversion `u₂ = u_z·4.87/ln(67.8z − 5.42)`) and Eq. 11 (Tetens `e°(T) = 0.6108·exp(17.27T/(T+237.3))`). https://www.fao.org/3/x0490e/x0490e00.htm [K; the formulas are verified as implemented in Open-Meteo `Meteorology.swift`].
- Alduchov, O.A., Eskridge, R.E. (1996). Improved Magnus form approximation of saturation vapor pressure. *Journal of Applied Meteorology* 35: 601–609. doi:10.1175/1520-0450(1996)035<0601:IMFAOS>2.0.CO;2 [K; the constants 17.625/243.04 are verified in Open-Meteo source].
- ECMWF open data (IFS 9 km open since 1 Oct 2025, as stated on Open-Meteo's ECMWF page). https://www.ecmwf.int/en/forecasts/datasets/open-data [K].
- Bureau of Meteorology. Observation JSON feeds `https://www.bom.gov.au/fwo/IDN60801/IDN60801.<WMO>.json`; data feeds catalogue http://www.bom.gov.au/catalogue/data-feeds.shtml ; anonymous FTP http://www.bom.gov.au/catalogue/anon-ftp.shtml ; copyright http://www.bom.gov.au/other/copyright.shtml ; Registered User charges http://reg.bom.gov.au/other/charges.shtml . Station list from OpenNEM `opennem/data/bom_stations.json` https://github.com/opennem/opennem ; block-page text from https://github.com/eyeballcode/snow-watcher (test/mock/blocked.html) and https://github.com/raei-2748/AUSSEF ; UA requirement from https://github.com/timjardenross/TJRHQ (bom_warnings.py, Aug 2026); field list from https://github.com/claws/txBOM .
- Unofficial BoM API: https://github.com/tonyallan/weather-au ; https://github.com/bremor/bureau_of_meteorology .
- WMO (2008, updated). *Guide to Meteorological Instruments and Methods of Observation* (WMO‑No. 8), Annex 4.B (Magnus formula). https://library.wmo.int/ [K].
- Stull, R.B. (1988). *An Introduction to Boundary Layer Meteorology*. Kluwer. doi:10.1007/978-94-009-3027-8 [K].

**Terrain**
- Tilezen/Mapzen Joerd docs: `formats.md`, `data-sources.md`, `attribution.md`. https://github.com/tilezen/joerd/tree/master/docs ; AWS Registry entry https://registry.opendata.aws/terrain-tiles/ ; bucket `s3://elevation-tiles-prod`.
- Gallant, J., Wilson, N., Dowling, T., Read, A., Inskeep, C. (2011). *SRTM-derived 1 Second Digital Elevation Models Version 1.0*. Geoscience Australia. http://pid.geoscience.gov.au/dataset/ga/72759 ; COGs at `s3://dea-public-data/projects/elevation/ga_srtm_dem1sv1_0/`.
- NSW Spatial Services, NSW 5 m Elevation ImageServer: https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer ; dataset page https://www.data.nsw.gov.au/data/dataset/1-437c0697e6524d8ebf10ad0d915bc219 . Third-party verification: https://github.com/jo-chemla/terrain-viewer (`lib/custom-sources.json`, Sept 2026); https://github.com/resuly/property-scores (`property_scores/flood/lidar.py`).
- Geoscience Australia ELVIS: https://elevation.fsdf.org.au/ ; GA 5 m LiDAR DEM https://pid.geoscience.gov.au/dataset/ga/89644 ; Mapterhorn https://github.com/mapterhorn/mapterhorn (source-catalog `au5*`).
- Horn, B.K.P. (1981). Hill shading and the reflectance map. *Proceedings of the IEEE* 69(1): 14–47. doi:10.1109/PROC.1981.11918 [K].
- Mapbox Terrain-DEM v1: https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/ [K].

**Imagery, canopy, land cover, vegetation**
- NSW SIX Maps imagery: https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer ; attribution per the OSM editor-layer-index `NSW-WebServices-Imagery.geojson` https://github.com/osmlab/editor-layer-index ; export limit per https://github.com/aussiewaska-coder/OpenStrike (`scripts/terrain/tile_client.gd`).
- Tolan, J. et al. (2024). Very high resolution canopy height maps from RGB imagery using self-supervised vision transformer and convolutional decoder trained on aerial lidar. *Remote Sensing of Environment* 300: 113888. doi:10.1016/j.rse.2023.113888 ; data https://registry.opendata.aws/dataforgood-fb-forests/ (bucket `dataforgood-fb-data/forests/v1/alsgedi_global_v6_float/`).
- Lang, N., Jetz, W., Schindler, K., Wegner, J.D. (2023). A high-resolution canopy height model of the Earth. *Nature Ecology & Evolution* 7: 1778–1789. doi:10.1038/s41559-023-02206-6 ; data doi:10.3929/ethz-b-000609802 ; https://github.com/langnico/global-canopy-height-model .
- Zanaga, D. et al. (2022). *ESA WorldCover 10 m 2021 v200*. doi:10.5281/zenodo.7254221 [K]; bucket readme https://esa-worldcover.s3.eu-central-1.amazonaws.com/readme.html .
- NSW DCCEEW, State Vegetation Type Map: https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/SVTM_NSW_Extant_PCT/MapServer ; SEED portal https://datasets.seed.nsw.gov.au/ [K].
- Olson, J.S. (1963). Energy storage and the balance of producers and decomposers in ecological systems. *Ecology* 44(2): 322–331. doi:10.2307/1932179 [K].
- Geoscience Australia / DEA, Sentinel-2 Fuel Moisture Content `ga_s2_fmc_3_v1`: https://explorer.dea.ga.gov.au/product/product/ga_s2_fmc_3_v1 ; bucket `s3://dea-public-data/derivative/ga_s2_fmc_3_v1/`. Method: Yebra, M. et al. (2018). A fuel moisture content and flammability monitoring methodology for continental Australia based on optical remote sensing. *Remote Sensing of Environment* 212: 260–272. doi:10.1016/j.rse.2018.04.053 [K].

**Fire history, incidents, hotspots**
- NPWS Fire History: https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0 ; field usage from https://github.com/resuly/property-scores (`bushfire/score.py`, `data/truth_anchors/canaries.json`) and https://github.com/chulund/redbackfire-static (`MapView.jsx`).
- NSW RFS feeds: https://www.rfs.nsw.gov.au/feeds/majorIncidents.json ; feed info https://www.rfs.nsw.gov.au/news-and-media/stay-up-to-date/feeds ; format notes https://github.com/beyondtracks/nsw-rfs-geojson-feeds ; https://github.com/exxamalte/python-aio-geojson-nsw-rfs-incidents ; live confirmation Aug 2026 https://github.com/timjardenross/TJRHQ .
  - 2026 CORS report and the Digital Atlas services: https://github.com/ben-gy/au-bushfires (`src/live.ts`, `plan.md`, `pipeline/collect.mjs`). Also https://github.com/ODIN-fire/odin-rs (`odin_bushfire/configs/bushfire.ron`) and https://github.com/mapollc/MAPOTechnology .
  - RFS hazard-reduction feed format: https://github.com/gangerang/bushwalkers-topo-datasets (`scripts/rfs_hr_burns_data_process.py`).
  - Feed size and cache header: https://github.com/JianlingTang/wildfire-ops-copilot (`docs/memory-and-context.md`).
- Geoscience Australia / Digital Atlas of Australia. *Historical Bushfire Boundaries* (ArcGIS item `db9ae2c1d2374e20b60f26c45118f6f3`) and *Near Real-Time Bushfire Boundaries* (item `8b28109ce26b43b8968a3c9baa608f43`). https://www.arcgis.com/home/item.html?id=8b28109ce26b43b8968a3c9baa608f43 ; https://digital.atlas.gov.au/ [3P; not reachable from the sandbox].
- NSW DCCEEW. *Fire Extent and Severity Mapping (FESM)* WMS: https://mapprod3.environment.nsw.gov.au/arcgis/services/Fire/FESM/MapServer/WMSServer ; layer usage from https://github.com/gangerang/bushwalkers-topos (`index.html`) [3P].
- NSW SIX/Spatial Services live browser usage (imagery subdomains, SPOT 2020, mapprod3 feature layers, SVTM WMS fallback): https://github.com/gangerang/bushwalkers-topos (`index.html`) [3P].
- NSW 5 m DEM provenance conflict: https://github.com/nico579/lidar2map (`providers/au_nsw.py`); size caps https://github.com/CJKorn/Elev-Map (`Sources/ElevMapProviders/ArcGISImageServerSource.swift`) [3P].
- SVTM fields and raster: https://github.com/mwhewins/ecoTools (`main.R`, `config.R`); https://github.com/Zen-TM/logjam (`topo/CLAUDE.md`) [3P].
- NASA FIRMS day-range behaviour (2026): https://github.com/Escherbridge/plantgeo (`services/agri-data-service/src/agri_data_service/ingest/firms.py`); https://github.com/krishnasharma1493/IGNISSENSE ; https://github.com/ArceusDesign/bali-air-dispatch [3P].
- Capacitor `@capacitor/file-transfer` (replacement for the deprecated `Filesystem.downloadFile`): https://capacitorjs.com/docs/apis/file-transfer [K; the deprecation notice is verified in the installed `@capacitor/filesystem` 8.1.3 types].
- Geoscience Australia (2020). *Digital Earth Australia Hotspots*. https://pid.geoscience.gov.au/dataset/ga/111881 ; product metadata https://github.com/GeoscienceAustralia/dea-knowledge-hub (`docs/data/product/dea-hotspots/_data.yaml`); WFS notes https://github.com/clemensv/real-time-sources (`tools/candidates/wildfire/dea-hotspots-australia.md`).
- NASA FIRMS Area API: https://firms.modaps.eosdis.nasa.gov/api/area/ ; MAP_KEY https://firms.modaps.eosdis.nasa.gov/api/map_key/ ; limits and day range from https://github.com/api-evangelist/nasa-firms (OpenAPI) and https://github.com/noelthomas-dev/TERSAGE .
- Noble, I.R., Bary, G.A.V., Gill, A.M. (1980). McArthur's fire-danger meters expressed as equations. *Australian Journal of Ecology* 5: 201–203. doi:10.1111/j.1442-9993.1980.tb01243.x [K].

**Platform**
- Capacitor 8 `CapacitorHttp` (`@capacitor/core` 8.5.2 types) and `@capacitor/filesystem` 8.1.3 `downloadFile` (installed in this repo); FireSim `src/data/http.ts`, `src/data/canopy.ts`, `capacitor.config.ts`.
