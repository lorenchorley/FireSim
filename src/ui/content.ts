/**
 * Static text content: the safety notice, weather presets and historic replays offered in Setup, the glossary (Help
 * tab), data attributions & licences and research references (About). Wording follows doc 10 §10.1: plain words,
 * "about" for numbers, never "you are safe".
 */
import { PRESET_IDS, WEATHER_PRESETS as SCENARIO_PRESETS } from '../scenario/presets';
import { REPLAYS as SCENARIO_REPLAYS } from '../scenario/replays';
import { ATTRIBUTION as RECORD_ATTRIBUTION } from '../scenario/recordKit';


/** Bump when the safety notice wording changes, so users see and accept it again. */
export const NOTICE_VERSION = 1;

export const SAFETY_NOTICE = {
  title: 'Training aid only',
  lead: 'FireSim is an education tool for learning how bushfires behave in mountain country.',
  points: [
    'It is not an operational prediction. Do not use it to make decisions on a fireground.',
    'Always follow your Incident Controller, your Crew Leader and NSW RFS procedures.',
    'Models are simplified and can be wrong — especially on steep slopes, in gullies and in extreme weather, where real fires are often faster than any model.',
    'LACES first: Lookouts, Awareness, Communications, Escape routes, Safety refuges.',
  ],
  accept: 'I understand — training use only',
};

export interface PresetOption {
  id: string;
  name: string;
  description: string;
  /** Local (LMST) start hour of the preset's canonical day (24 h). */
  startHour: number;
  /** Canonical local month (1–12) and day the preset is designed for (sun angle, curing; the FBI chip is defined there). */
  month: number;
  day: number;
  /** Rating the preset produces at its chip time, for the card chip. */
  rating: 'Moderate' | 'High' | 'Extreme' | 'Catastrophic' | 'No rating';
}

/**
 * Weather presets offered in Setup: the scenario builder's catalogue (src/scenario/presets, spec §11.3), so ids,
 * names and the rating chip always match what the builder runs.
 */
export const WEATHER_PRESETS: PresetOption[] = PRESET_IDS.map((id) => {
  const p = SCENARIO_PRESETS[id];
  return { id, name: p.name, description: p.description, startHour: p.canonical.startLmst, month: p.canonical.month, day: p.canonical.day, rating: p.chip.rating };
});

export interface ReplayOption {
  /** Replay id resolved by the scenario builder (WeatherMode { kind: 'replay' }): `<siteId>-<yyyy-mm-dd>`. */
  id: string;
  siteId: string;
  date: string;
  name: string;
  description: string;
}

/** Historic fire days with bundled hourly weather (public/replays/): the scenario builder's catalogue (§11.4). */
export const REPLAYS: ReplayOption[] = SCENARIO_REPLAYS.map((r) => ({ id: r.id, siteId: r.site, date: r.date, name: r.name, description: r.story }));

export interface GlossaryEntry {
  term: string;
  short?: string;
  body: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    term: 'ROS',
    short: 'Rate of spread',
    body: 'How fast the fire edge moves, usually in km/h or m/h. The head (front) is fastest, the flanks slower, the back slowest. Walking uphill on a 20° track is only about 1.4 km/h — you cannot outrun a fire uphill.',
  },
  {
    term: 'FFDI',
    short: 'McArthur Forest Fire Danger Index',
    body: 'A number from temperature, humidity, wind and drought (drought factor 0–10). About 12 = moderate, 24 = high, 50 = extreme, 100 = catastrophic. It assumes flat ground — slopes can make the same weather far worse.',
  },
  {
    term: 'Fire Danger Rating (AFDRS)',
    body: 'The public rating since 2022: Moderate, High, Extreme, Catastrophic. It is calculated for broad districts and fuel types, not for your slope or gully.',
  },
  {
    term: 'Dead fine fuel moisture',
    short: 'Litter moisture',
    body: 'Water content of dead leaves, twigs and bark thinner than 6 mm, as % of dry weight. It follows the air within an hour. Below about 6 % embers catch easily; above about 20 % fire struggles.',
  },
  {
    term: 'Slope effect',
    body: 'Uphill, flames lean onto the fuel ahead and pre-heat it, so the fire roughly doubles its speed every 10° of slope. Downhill it slows, but not below about half its flat-ground speed.',
  },
  {
    term: 'Flame attachment / eruptive fire',
    body: 'On slopes steeper than about 24°, and in gullies and chimneys, the flames can lie down along the ground and the fire can accelerate suddenly without any change in the weather. Classic cause of burnovers.',
  },
  {
    term: 'VLS',
    short: 'Vorticity-driven lateral spread',
    body: 'Strong wind over a steep lee slope creates a spinning eddy. Fire caught in it runs sideways along the slope, across the wind, and throws embers far downwind. Seen in the 2003 Canberra fires.',
  },
  {
    term: 'Anabatic wind',
    body: 'Upslope and up-valley breeze on sunny days, driven by sun-heated slopes. It adds to the uphill push on a fire from late morning.',
  },
  {
    term: 'Katabatic wind',
    body: 'Downslope and down-valley drainage of cold air at night and in shade. Fires back down gullies, and smoke sinks and pools in valleys.',
  },
  {
    term: 'Inversion',
    body: 'A layer where temperature increases with height, usually overnight. It traps smoke and holds fire activity down until the morning sun breaks it — then winds from above can reach the fire within minutes.',
  },
  {
    term: 'Thermal belt',
    body: 'A band on the middle of mountain slopes that stays warmer and drier at night, above the cold air pooled in the valley. Fire keeps burning there when the valley floor goes quiet.',
  },
  {
    term: 'Wind change',
    body: 'A sudden swing in wind direction, typically a SW change after hot NW winds. The long flank of the fire becomes a wide head fire. A wind change was the main factor in many Australian firefighter entrapments.',
  },
  {
    term: 'Dead man zone',
    body: 'The ground next to the fire that would burn within about 5 minutes after a wind change (Cheney et al. 2001). It can be under 100 m or well over 1 km wide. Get into the black or a refuge before the change.',
  },
  {
    term: 'Spotting',
    body: 'Burning bark and leaves (embers) carried ahead of the fire start new spot fires. Stringybark is the worst source. Spot fires below the main fire run uphill to meet it.',
  },
  {
    term: 'Junction zone',
    body: 'Where two fire edges meet at a narrow angle (e.g. a back burn and the main fire). The meeting point can move several times faster than either fire. Stay out of the “V”.',
  },
  {
    term: 'Byram convective number',
    body: 'Compares the fire’s heat with the wind’s power. Below about 2 the wind drives the fire; above about 10 the fire’s own plume dominates and near-fire winds stop following the forecast.',
  },
  {
    term: 'PyroCb',
    short: 'Pyrocumulonimbus',
    body: 'A thunderstorm made by the fire’s own plume. It brings erratic strong winds, lightning and long-range spotting. Watch for a capped, towering column and sudden calm.',
  },
  {
    term: 'Back burn',
    body: 'Fire lit deliberately from a control line to remove fuel ahead of the main fire. Needs the right weather, an anchor and a plan for the wind change; can create junction zones.',
  },
  {
    term: 'LACES',
    body: 'Lookouts, Awareness, Communications, Escape routes, Safety refuges — the Australian fireground safety system. A refuge needs clearance of at least 4× the flame height, and more on slopes or in wind.',
  },
  {
    term: 'Intensity',
    short: 'Byram fireline intensity (kW/m)',
    body: 'Energy released per metre of fire edge. Under about 500 kW/m hand tools can hold it; above about 4,000 kW/m only indirect attack; above 10,000 kW/m crown fire is likely.',
  },
  {
    term: 'Fuel hazard',
    body: 'Scores (low → extreme) for surface litter, near-surface grass and low shrubs, elevated shrubs and bark (Overall Fuel Hazard Assessment Guide). They drive spread rate and flame height in the Vesta model.',
  },
  {
    term: 'Time since fire',
    body: 'Fuel re-accumulates over about 10–20 years after a fire or hazard-reduction burn. Recently burnt ground slows a fire and is a better anchor, but only for a few years.',
  },
];

/**
 * One credit line of Settings → Data and licences. The list names exactly the data the app uses (checked against the
 * data-set records, src/scenario/datasetAttribution.test.ts), and the feeds it can read but does not use yet are marked
 * so nothing is over-claimed.
 */
export interface Attribution {
  name: string;
  use: string;
  licence: string;
  /** Who publishes it. */
  provider?: string;
  /** The credit line the data carry (the same text as the data-set records' `attribution`). */
  attribution?: string;
  /** 'used' (every scenario that needs it), 'fallback' (only when the first choice is missing), 'not-used' (the app can read it but does not use it yet). */
  status?: 'used' | 'fallback' | 'not-used';
}

export const ATTRIBUTIONS: Attribution[] = [
  {
    name: 'NSW Spatial Services (elevation)',
    provider: 'NSW Spatial Services, Department of Customer Service',
    use: 'Ground height for the demo sites: the NSW 5 m elevation model (NSW_5M_Elevation, which the service says is derived from stereo imagery), bundled at 10 m',
    licence: '© Spatial Services NSW, CC BY 4.0',
    attribution: RECORD_ATTRIBUTION.spatial,
    status: 'used',
  },
  {
    name: 'NSW Spatial Services (aerial imagery)',
    provider: 'NSW Spatial Services, Department of Customer Service',
    use: 'Aerial photos of the demo sites (NSW_Imagery, a mosaic of flights from several years), display only',
    licence: 'CC BY 4.0',
    attribution: RECORD_ATTRIBUTION.imagery,
    status: 'used',
  },
  {
    name: 'SRTM / AWS Terrain Tiles (Mapzen Terrarium)',
    provider: 'NASA / U.S. Geological Survey SRTM, tiles by Mapzen on AWS Open Data',
    use: 'Ground height (about 30 m) outside the demo sites',
    licence: 'Public domain (NASA/USGS SRTM); tiles via AWS Open Data',
    attribution: RECORD_ATTRIBUTION.terrarium,
    status: 'fallback',
  },
  {
    name: 'Meta & World Resources Institute',
    provider: 'Meta and World Resources Institute (WRI)',
    use: 'Tree canopy height and cover (High Resolution Canopy Height Maps v1, Tolan et al. 2024)',
    licence: 'CC BY 4.0',
    attribution: RECORD_ATTRIBUTION.meta,
    status: 'used',
  },
  {
    name: 'NSW State Vegetation Type Map (SVTM)',
    provider: 'NSW Department of Climate Change, Energy, the Environment and Water (DCCEEW)',
    use: 'Vegetation formations and classes → fuel types',
    licence: '© State of NSW and DCCEEW, CC BY 4.0',
    attribution: RECORD_ATTRIBUTION.svtm,
    status: 'used',
  },
  {
    name: 'NSW National Parks and Wildlife Service',
    provider: 'NSW National Parks and Wildlife Service (DCCEEW)',
    use: 'Fire history (wildfires and prescribed burns)',
    licence: '© State of NSW and DCCEEW, CC BY 4.0',
    attribution: RECORD_ATTRIBUTION.npws,
    status: 'used',
  },
  { name: 'NSW Spatial Services (roads and fire trails)', provider: 'NSW Spatial Services', use: 'Roads and tracks (Transport Theme) and RFS-classified fire trails for the Roads layer', licence: '© Spatial Services NSW, CC BY 4.0', attribution: '© Spatial Services NSW', status: 'used' },
  { name: 'NSW Spatial Services (addresses)', provider: 'NSW Spatial Services', use: 'Home address points (Geocoded Addressing Theme) for the Homes layer', licence: '© Spatial Services NSW, CC BY 4.0', attribution: '© Spatial Services NSW', status: 'used' },
  { name: 'NSW Spatial Services (place names)', provider: 'NSW Spatial Services', use: 'Place and suburb names (Features of Interest, Administrative Boundaries) to help you find your way', licence: '© Spatial Services NSW, CC BY 4.0', attribution: '© Spatial Services NSW', status: 'used' },
  {
    name: 'NSW Planning (land zoning)',
    provider: 'NSW Department of Planning, Housing and Infrastructure',
    use: 'Residential, village and other built-up land-use zones (ePlanning Land Zoning Map)',
    licence: '© State of NSW and Department of Planning, Housing and Infrastructure, CC BY 4.0',
    attribution: '© State of NSW and Department of Planning, Housing and Infrastructure',
    status: 'used',
  },
  {
    name: 'Open-Meteo',
    provider: 'Open-Meteo.com',
    // Open-Meteo's documentation (read 2026-09-30) says only that 'best match' gives "the best forecast for any given
    // location"; it does not say which models that combines for Australia, and it reports the Bureau of Meteorology's
    // ACCESS-G open data as temporarily suspended. So no model is named that the app cannot verify.
    use: "Weather: forecasts from Open-Meteo's automatic 'best match' (the model it judges best for the location; the answer does not say which), past weather, the year of daily rain behind the drought index, and the historic fire days",
    licence: 'CC BY 4.0 (free for non-commercial use, which includes education)',
    attribution: RECORD_ATTRIBUTION.openMeteo,
    status: 'used',
  },
  {
    name: 'ECMWF IFS (through Open-Meteo)',
    provider: 'European Centre for Medium-Range Weather Forecasts',
    use: "Forecast when 'best match' fails, upper-air levels (IFS 0.25°), the 2019/20 historic fire days (historical forecasts), and, from 2017, part of the archive's default 'best match' behind the year of daily rain (IFS HRES analysis, 9 km)",
    licence: 'CC BY 4.0 (ECMWF open data)',
    status: 'used',
  },
  {
    name: 'NOAA GFS (through Open-Meteo)',
    provider: 'U.S. National Oceanic and Atmospheric Administration',
    use: 'Upper-air levels only when the ECMWF levels are missing',
    licence: 'Public domain (U.S. Government work)',
    status: 'fallback',
  },
  {
    name: 'Copernicus ERA5 (through Open-Meteo)',
    provider: 'Copernicus Climate Change Service / ECMWF',
    use: "Past weather before 2016 (and later dates when the historical forecast is missing) and the 2013 historic fire days; with ERA5-Land and the ECMWF IFS analysis, part of the archive's default 'best match' behind the year of daily rain and temperature for the drought index and the usual yearly rainfall",
    licence: 'CC BY 4.0 through Open-Meteo; contains modified Copernicus Climate Change Service information',
    status: 'used',
  },
  {
    name: 'NSW Rural Fire Service (incidents feed)',
    provider: 'NSW Rural Fire Service',
    use: 'Not used yet: the app can read the current-incidents and fire-danger feeds but does not show them',
    licence: '© NSW RFS, information only',
    status: 'not-used',
  },
  {
    name: 'Geoscience Australia DEA Hotspots',
    provider: 'Geoscience Australia (Digital Earth Australia)',
    use: 'Not used yet: the app can read satellite fire hotspots but does not show them',
    licence: 'CC BY 4.0',
    status: 'not-used',
  },
];

export const REFERENCES: { file: string; title: string }[] = [
  { file: '01-terrain-fire-behaviour.md', title: 'Terrain and fire behaviour' },
  { file: '02-mountain-meteorology.md', title: 'Mountain meteorology' },
  { file: '03-australian-fire-models.md', title: 'Australian fire behaviour models' },
  { file: '04-fuel-moisture.md', title: 'Fuel moisture' },
  { file: '05-fuel-accumulation-history.md', title: 'Fuel accumulation and fire history' },
  { file: '06-embers-spotting.md', title: 'Embers and spotting' },
  { file: '07-fire-atmosphere-coupling.md', title: 'Fire–atmosphere coupling' },
  { file: '08-data-sources-apis.md', title: 'Data sources and APIs' },
  { file: '09-mobile-tech-stack.md', title: 'Mobile technology and field UX' },
  { file: '10-firefighter-education.md', title: 'Firefighter education and safety content' },
];
