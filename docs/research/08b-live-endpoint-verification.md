# 08b — Live endpoint verification

**Date:** 2026-09-27 (fetched between 09:30 and 10:00 UTC)
**Branch:** `claude/firesim-live-fixtures`

A first attempt the same morning was refused by the sandbox egress proxy for every host
below (HTTP 403 on `CONNECT`). After the environment's network policy was widened, every
host responded and every fixture listed here was fetched from the live services.

All CORS checks were sent with `Origin: http://localhost`. **Every endpoint returned an
`Access-Control-Allow-Origin` header**, which contradicts `08-data-sources-apis.md` for
the NSW RFS feed.

## Summary

| # | Endpoint | Status | Time | Size | ACAO | Output |
|---|---|---|---|---|---|---|
| 1 | SIX `NSW_5M_Elevation/ImageServer/exportImage` | 200 | 27–250 s (cold) | 16.8 MB/site (F32 TIFF 1923²) | `*` | `public/demo/<id>/dem5m.png\|json` |
| 2 | SIX `NSW_Imagery/MapServer/tile/15/{y}/{x}` | 200 | ~1.2 s/tile | 15–22 KB/tile, 100–110 tiles/site | `*` | `public/demo/<id>/imagery.jpg\|json` |
| 3 | SEED `Fire/NPWS_Fire_History/MapServer/0/query` | 200 | 1–2 s | 50–554 KB/site | `*` | `public/demo/<id>/fire-history.geojson` |
| 4 | SEED `VIS/SVTM_NSW_Extant_PCT/MapServer/3/query` | 200 | 2–8 s/page | 1.3–9.4 MB raw/site | `*` | `public/demo/<id>/vegetation.geojson` |
| 5 | `api.open-meteo.com/v1/forecast` | 200 (after 429s) | 0.5–1.0 s | 77–79 KB | `*` | `tests/fixtures/live/openmeteo-forecast-katoomba[-access].json` |
| 6 | `archive-api.open-meteo.com/v1/archive` | 200 (after 429s) | 0.6–1.0 s | 10 KB | `*` | `openmeteo-archive-katoomba-365d.json`, `replay-*-daily365.json`, ERA5 replays |
| 7 | `historical-forecast-api.open-meteo.com/v1/forecast` | 200 | 0.7–1.0 s | 18–24 KB | `*` | `replay-<site>-<start>.json` (2019/20 sites) |
| 8 | `www.rfs.nsw.gov.au/feeds/majorIncidents.json`, `fdrToban.xml` | 200 | 1.3 s / 0.9 s | 228 KB / 7.9 KB | `*` | `rfs-majorIncidents.json`, `rfs-fdrToban.xml` |
| 9 | `hotspots.dea.ga.gov.au/geoserver/public/wfs` | 200 | 2.8 s | 182 KB (200 features) | echoes origin + credentials | `dea-hotspots-sample.json` |

### Bytes added per site (`public/demo/<id>/`, new files only)

| Site | dem5m.png | imagery.jpg | fire-history | vegetation | Total (incl. json) |
|---|---|---|---|---|---|
| katoomba | 1,411,059 | 271,203 | 290,512 (96 polys) | 1,491,893 (3059) | 3,465,532 |
| grose | 1,468,910 | 235,267 | 425,354 (64) | 1,406,636 (2724) | 3,537,021 |
| kanangra | 1,509,929 | 252,524 | 350,460 (15) | 1,010,607 (1508) | 3,124,381 |
| thredbo | 1,416,453 | 273,368 | 554,058 (10) | 789,434 (1421) | 3,034,168 |
| gospers | 1,461,838 | 246,856 | 434,535 (44) | 1,092,279 (1695) | 3,236,364 |
| budawangs | 1,421,343 | 275,224 | 429,027 (78) | 1,011,934 (1630) | 3,138,388 |
| barrington | 1,439,612 | 283,556 | 50,391 (14) | 495,475 (663) | 2,269,898 |
| warrumbungles | 1,416,358 | 301,921 | 265,423 (40) | 800,989 (1188) | 2,785,561 |
| **Sites total** | | | | | **24,591,313** |

`tests/fixtures/live/` adds 788,837 bytes, so the grand total is about 25.4 MB.

### Grid convention (all rasters)

Each raster is a square of side 9000 m centred on the `DEMO_SITES` centre, with row 0 at
the north. Cell (col,row) has its centre at `x = -4500 + (col+0.5)*cell` and
`y = 4500 - (row+0.5)*cell`. Local coordinates convert to geographic as
`lat = lat0 + y/111195.08`, `lon = lon0 + x/(111195.08*cos(lat0))`. This matches
`canopy.json`.

---

## 1. NSW 5 m DEM: `maps.six.nsw.gov.au` ImageServer

**Metadata** (`…/NSW_5M_Elevation/ImageServer?f=json`): `pixelType: F32`, `pixelSizeX/Y: 5`,
`maxImageWidth: 15000`, **`maxImageHeight: 4100`**, SR 102100/3857, `noDataValue: null`,
`copyrightText: "DFSI 2019"`. Extent xmin 15696048, xmax 17143733 (EPSG:3857).

**Working URL** (Katoomba; the other sites differ only in bbox):

```
https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_5M_Elevation/ImageServer/exportImage
  ?bbox=<xmin>,<ymin>,<xmax>,<ymax>&bboxSR=3857&imageSR=3857&size=1923,1923
  &format=tiff&pixelType=F32&noData=-9999&noDataInterpretation=esriNoDataMatchAny
  &interpolation=RSP_BilinearInterpolation&f=image
```

- The bbox is the 9 km square plus a 300 m margin, projected to 3857. The pixel size is
  5 m ground × 1/cos(lat) in Mercator units. **One request per site was enough** (1923 px
  is under the 4100 cap), so no tiling was needed.
- Each response is an uncompressed 16,780,452-byte Float32 GeoTIFF. It is **slow**: 26.8 s
  (barrington) to 249 s (thredbo), with one connection reset that succeeded on retry. The
  28 s "cold" figure in doc 08 is optimistic.
- Resampling: bilinear onto the local 10 m grid (n = 900). The PNG is Terrarium RGB
  (`v = h + 32768`, R = ⌊v/256⌋, G = ⌊v⌋ mod 256, B = ⌊frac(v)·256⌋). **No NoData cells
  occurred at any site.**
- Sanity checks (all pass):

| Site | min (m) | max (m) | Spot checks |
|---|---|---|---|
| katoomba | 247.2 | 1076.5 | Katoomba station 1021.6 m; Narrow Neck 963 m; valley-floor minimum 247 m |
| grose | 299.1 | 1090.6 | |
| kanangra | 220.3 | 1289.8 | |
| thredbo | 1266.1 | 2190.2 | Thredbo village 1378 m; ridge tops up to 2190 m |
| gospers | 244.3 | 620.8 | |
| budawangs | 25.9 | 717.1 | max ≈ Pigeon House summit (720 m) |
| barrington | 510.6 | 1547.2 | |
| warrumbungles | 425.2 | 1163.7 | |

- The imagery lines up with a hillshade of `dem5m.png` (cliff lines match the Katoomba
  town edge).
- Licence: CC BY 4.0, "© Spatial Services NSW". The service `copyrightText` says "DFSI 2019".

## 2. NSW imagery: `maps.six.nsw.gov.au` tiles

- **Working URL:** `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/15/{y}/{x}`,
  e.g. `/tile/15/19645/30065` → 200, `image/jpeg`, 256×256, 21,550 B, 1.4 s. The y/x order
  is confirmed.
- **CORS:** `Access-Control-Allow-Origin: *` plus `Access-Control-Allow-Credentials: true`,
  so WebGL textures can be loaded directly.
- Metadata: `copyrightText: "© Department of Customer Service 2020"`, tile LODs up to 23,
  `maxImageWidth: 4096` (for `export`).
- z15 is about 4 m ground/px at −33°. Each site needs 10×10 tiles (thredbo 11×10). Tiles
  were 2×2 area-averaged, then bilinear-resampled to the 8 m grid (n = 1125) and saved as
  progressive JPEG q82. Every file is 235–302 KB, well under 700 KB. There were intermittent
  `Connection reset by peer` errors (≈ 5 % of requests), all fine on retry. On the first
  thredbo run 2 tiles failed after retries, so it was re-run with 0 failures.
- Visible seams between capture dates exist in the source mosaic (e.g. south-west of
  Katoomba). They are in the data, not an artefact of the resampling.
- Licence: CC BY 4.0, "© Spatial Services NSW".

## 3. NPWS Fire History: `mapprod3.environment.nsw.gov.au`

- **Working URL:**
  ```
  https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Fire/NPWS_Fire_History/MapServer/0/query
    ?geometry=<w>,<s>,<e>,<n>&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects
    &where=1=1&outFields=*&returnGeometry=true&outSR=4326&maxAllowableOffset=0.00005&geometryPrecision=6
    &orderByFields=OBJECTID&resultOffset=0&resultRecordCount=1000&f=geojson
  ```
- `maxRecordCount: 1000`. No site exceeded one page (max 96 features). Polygons are **not
  clipped**: they are whole fire perimeters that intersect the bbox.
- **Fields (more than doc 08 lists):** `OBJECTID, FireType, FireName, FireNo, FireYear, Label,
  StartDate, EndDate, Intensity, AreaHa, PerimeterM, OFHObjMet, ObjNotMet, NPWSBranch,
  NPWSArea, Shape, VerDate, Shape.STArea(), Shape.STLength()`.
- Example values:
  ```json
  {"OBJECTID":1973,"FireType":1,"FireName":"Warragamba","FireNo":"","FireYear":196768,
   "Label":"1967-68 Wildfire","StartDate":-64281600000,"EndDate":null,"Intensity":null,
   "AreaHa":1396.56,"PerimeterM":16357.06,"NPWSBranch":"BMTN","NPWSArea":"UPMT","VerDate":1788739200000}
  {"OBJECTID":10632,"FireType":1,"FireName":"Thredbo Valley","FireYear":198788,
   "Label":"1987-88 Wildfire","StartDate":null,"Intensity":9999,"AreaHa":37.57,"NPWSBranch":"STHR","NPWSArea":"SNOW"}
  ```
- Differences from doc 08:
  - `FireYear` is an **integer** season code (196768), not a string.
  - `StartDate`/`EndDate`/`VerDate` are **epoch milliseconds**. They are often null, and
    can be negative (pre-1970).
  - `Label` ("1967-68 Wildfire") is convenient for display.
  - `Intensity` is mostly null, or `9999` (unknown).
  - `FireType` is confirmed: 1 = wildfire, 2 = prescribed burn. Katoomba has 37 wildfires
    and 59 prescribed burns.
- Licence: CC BY 4.0, "© State of NSW and Department of Climate Change, Energy, the
  Environment and Water" (the service `copyrightText` is empty).

## 4. SVTM vegetation: `mapprod3.environment.nsw.gov.au`

- **Layer ids differ from doc 08.** `…/VIS/SVTM_NSW_Extant_PCT/MapServer?f=json` gives:

  | id | name | type | scale band |
  |---|---|---|---|
  | 0 | NSW_VegetationFormation_5m | **Raster Layer** | 1:1,000,001 → 0 |
  | 1 | NSW_VegetationClass_5m | **Raster Layer** | 1:1,000,000 → 1:100,001 |
  | 2 | NSW_PlantCommunityType_5m | **Raster Layer** | 1:100,000 → 1:25,001 |
  | 3 | Plant Community Type with labels | **Feature Layer (polygon)** | 1:25,000 → 0 |

  Doc 08 had this order reversed (0 = labels, 3 = formation). **Layer 3 is the only vector
  layer**, and it carries formation, class and PCT together.
- Layer 3 fields: `OBJECTID, Shape, PCTID (int), PCTName, vegClass, vegForm, form_PCT,
  labels, PCT_form, Shape_Length, Shape_Area`. The fixtures keep `OBJECTID, PCTID, PCTName,
  vegClass, vegForm`. The rest are concatenations of those.
- **Working URL:** same query pattern as §3 on `/MapServer/3/query`, with
  `outFields=OBJECTID,PCTID,PCTName,vegClass,vegForm`, **`maxAllowableOffset=0.0002`** and
  `geometryPrecision=5`, paged with `resultOffset` in steps of 1000 (`maxRecordCount 1000`;
  up to 4 pages per site).
- **Deviation from the brief:** even at an offset of 0.0001, Katoomba was 9.4 MB. The main
  cause was a few "Not classified" polygons (cleared or urban land) of up to 5 MB each that
  extend far outside the bbox. The fix was to clip every polygon locally (shapely) to the
  9 km bbox + 100 m and raise the offset to 0.0002° (≈ 20 m). After that, every file is
  under 1.5 MB. Each FeatureCollection records the clip box in `clippedTo`.
- Example: `{"OBJECTID":3181920,"PCTID":0,"PCTName":"Not classified","vegClass":"Not classified","vegForm":"Not classified"}`.
  The formations seen at Katoomba were Dry Sclerophyll Forests (Shrubby sub-formation)
  1533, Not classified 588, Freshwater Wetlands 283, Heathlands 193, Dry Sclerophyll
  (Shrub/grass) 169, Rainforests 130, Wet Sclerophyll (Shrubby) 80 and Grassy Woodlands 75.
  `PCTID = 0` means not classified.
- Licence: CC BY 4.0, "© State of NSW and DCCEEW".

## 5. Open-Meteo forecast

- **Working URL:**
  ```
  https://api.open-meteo.com/v1/forecast?latitude=-33.715&longitude=150.285&past_days=7&forecast_days=7
    &timezone=Australia/Sydney&wind_speed_unit=ms&hourly=<22 surface vars>,<20 pressure-level vars>[&models=bom_access_global]
  ```
  The surface variables are those in the brief. The pressure-level variables are
  `temperature|relative_humidity|wind_speed|wind_direction|geopotential_height` × `925|850|700|500hPa`.
- Structure: `{latitude, longitude, generationtime_ms, utc_offset_seconds:36000, timezone,
  timezone_abbreviation:"GMT+10", elevation, hourly_units:{…}, hourly:{time:[…336], <var>:[…]}}`.
  The grid point for best_match is −33.708, 150.261, elevation 715 m (the model grid point
  sits in the valley, not on the 1000 m plateau). Excerpt for 2026-09-21T12:00: T 25.5 °C,
  RH 28 %, Td 5.8 °C, SW 862 W/m², T850 15.6 °C, Z500 5785 m, BLH 1505 m.
- **best_match:** all 42 variables present, no nulls.
- **`bom_access_global`: every variable is null for all 336 hours**, including a minimal
  `hourly=temperature_2m&forecast_days=3` request. The grid point is −33.691, 150.205.
  ACCESS-G currently cannot be used through Open-Meteo, so the app must not depend on it.
  (`bom_access_global_ensemble` does return members.)
- **Rate limiting:** the sandbox shares its egress IP. Open-Meteo returned
  `429 {"reason":"Daily API request limit exceeded. Please try again tomorrow."}`
  intermittently on forecast, archive and historical-forecast calls. Every request
  eventually succeeded after waiting 60 s one to three times. A production app should
  cache aggressively and back off on 429; users behind carrier-grade NAT could hit this.
- Licence: CC BY 4.0, "Weather data by Open-Meteo.com". The underlying models have their
  own attributions (ECMWF, BoM, etc.).

## 6. Open-Meteo archive (ERA5)

- `https://archive-api.open-meteo.com/v1/archive?latitude=-33.715&longitude=150.285&start_date=2025-09-22&end_date=2026-09-21&daily=precipitation_sum,temperature_2m_max,temperature_2m_min&timezone=Australia/Sydney&wind_speed_unit=ms`
  → 365 days, 10,423 B. The Katoomba 365-day rain total is 800.8 mm.
- The 2013 replays (katoomba, warrumbungles) used the archive API with `models=era5` and
  hourly variables. The archive has **no 80/120/180 m winds and no pressure levels**, so I
  substituted `wind_speed_100m, wind_direction_100m` and `soil_moisture_0_to_7cm`. In
  ERA5, **`cape` came back all-null**. BLH, VPD, radiation, gusts and the other variables
  were fine. The ERA5 grid is 0.25° (the Katoomba point snaps to −33.75, 150.25).

## 7. Historical replays (`historical-forecast-api`, `models=ecmwf_ifs`)

| File | Period | Grid point / elev |
|---|---|---|
| `replay-gospers-2019-12-19.json` | 2019-12-19 → 22 (96 h) | −33.005, 150.626 / 363 m |
| `replay-grose-2019-12-19.json` | 2019-12-19 → 22 | |
| `replay-kanangra-2019-12-17.json` | 2019-12-17 → 20 | |
| `replay-budawangs-2019-12-30.json` | 2019-12-30 → 2020-01-01 (72 h) | |
| `replay-thredbo-2020-01-02.json` | 2020-01-02 → 05 | |
| `replay-katoomba-2013-10-16.json` | 2013-10-16 → 18 (ERA5, §6) | −33.75, 150.25 / 715 m |
| `replay-warrumbungles-2013-01-12.json` | 2013-01-12 → 14 (ERA5, §6) | |

Each replay also has a `-daily365.json` file: archive daily rain/Tmax/Tmin for the 365
days before the start date.

- **In 2019–20, `ecmwf_ifs` returns all-null for:** `wind_speed_180m`, `wind_direction_180m`,
  `boundary_layer_height`, `cape`, `soil_moisture_0_to_1cm` and **all 20 pressure-level
  variables**. The 2 m/10 m/80 m/120 m, radiation, VPD and surface-pressure variables are
  present.
- A probe with `models=gfs_seamless` for 2019-12-19 was also all-null for 850/700 hPa, BLH
  and CAPE. **Pressure-level data are not available for these historical dates from
  Open-Meteo.** For upper-air profiles, the app would need to synthesise them (e.g. a
  lapse-rate assumption) or use another source.
- Sanity check (Gospers, 19–22 Dec 2019): max T 42.5 °C, min RH 11 %, max gust 25.2 m/s.
  That is consistent with the recorded catastrophic conditions.

## 8. NSW RFS feeds

- `https://www.rfs.nsw.gov.au/feeds/majorIncidents.json` → 200, `application/json`,
  228,030 B, 1.3 s. It is served from S3 (`x-amz-*` headers), with `last-modified` a few
  minutes old.
- **CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET`, `Max-Age: 3000`.**
  This **contradicts doc 08** ("no CORS"). The browser can fetch it directly, although a
  proxy fallback is still prudent.
- Structure: a `FeatureCollection` of 64 features. Geometry is either a `Point` (21) or a
  `GeometryCollection` (43) of `[Point, GeometryCollection[Polygon…]]`. Properties:
  ```json
  {"title":"AERODROME ROAD, MINIMBAH","link":"https://www.rfs.nsw.gov.au/fire-information/fires-near-me",
   "category":"Advice","guid":"https://incidents.rfs.nsw.gov.au/api/v1/incidents/679389","guid_isPermaLink":"true",
   "pubDate":"27/09/2026 7:01:00 AM",
   "description":"ALERT LEVEL: Advice <br />LOCATION: AERODROME ROAD, MINIMBAH 2428 <br />COUNCIL AREA: Mid-Coast <br />STATUS: Under control <br />TYPE: Grass Fire <br />FIRE: Yes <br />SIZE: 67 ha <br />RESPONSIBLE AGENCY: Rural Fire Service <br />UPDATED: 27 Sep 2026 17:01"}
  ```
  Categories seen were Advice 31, Not Applicable 21 and Planned Burn 12. `description` also
  carries `ALERT LEVEL` and `UPDATED`, which doc 08 does not mention. `pubDate` is
  `dd/mm/yyyy h:mm:ss AM` local time.
- `https://www.rfs.nsw.gov.au/feeds/fdrToban.xml` → 200, `text/xml`, 7,901 B, 0.9 s, same
  CORS headers. Its shape is `<FireDangerMap><District><Name/><RegionNumber/><Councils/>
  <DangerLevelToday/>…`.
- Licence: CC BY 4.0, "© State of NSW (NSW Rural Fire Service)".

## 9. DEA Hotspots WFS

- **Working URL:**
  ```
  https://hotspots.dea.ga.gov.au/geoserver/public/wfs?service=WFS&version=1.1.0&request=GetFeature
    &typeName=public:hotspots_three_days&outputFormat=application/json&maxFeatures=200
    &bbox=140.9,-37.6,153.7,-28.1,EPSG:4326
  ```
- **Gotcha:** with the `EPSG:4326` suffix, GeoServer expects **lon,lat** order. A lat,lon
  bbox returns 0 features, and a bbox without the CRS suffix also returned 0. The NSW bbox
  matched 5017 hotspots (numberMatched) over 3 days. The whole layer holds 219,194.
- CORS: the server **echoes the request Origin** (`Access-Control-Allow-Origin: http://localhost`)
  together with `Access-Control-Allow-Credentials: true`.
- Feature shape: `Point` geometry (`geometry_name: "location"`). Properties:
  `id, satellite ("SUOMI NPP"/"NOAA 21"/"HIMAWARI-9"), satellite_nssdc_id, satellite_operating_agency,
  sensor ("AHI"/VIIRS), orbit, start_dt, stop_dt, filename, process_dt, process_algorithm,
  process_algorithm_version, product, load_dt, latitude, longitude, geometry, temp_kelvin,
  datetime, power, confidence, australian_state, fire_category_name, hours_since_hotspot, …`.
  The response also includes `totalFeatures`, `numberMatched`, `numberReturned` and `timeStamp`.
- Licence: CC BY 4.0, "© Commonwealth of Australia (Geoscience Australia)".

## Reproduction notes

The fetch and resample scripts were run from a scratch directory, not committed, to keep
this change data-only. All parameters needed to reproduce the data are above, and each
`dem5m.json` / `imagery.json` records its method in `source`.
