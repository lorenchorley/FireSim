/**
 * Tunable constants of the scenario builder (spec docs/research/00-synthesis.md §11, §0.1).
 *
 * Every [H] (FireSim heuristic / design choice) and UNVERIFIED value used by scenario/ lives here, documented with
 * its source. Values the spec states as verified facts or fixed rules ([V], [K], [D]) are also collected here when
 * they are configuration-like (service limits, table data) so the whole module can be tuned from one place; the tag
 * in each comment says which is which.
 */
import { DEMO_EXTENT_M } from '../data/demoSites';

export const SCENARIO_PARAMS = Object.freeze({
  // ───────────────────────────── grids and extents (§11.6, §12.6) ─────────────────────────────
  /** Smallest / largest square domain side (m) accepted by the builder (ScenarioRequest doc: 3000–12000). [D] */
  minExtentM: 3000,
  maxExtentM: 12000,
  /** Bundled demo square (m); replays and offline demo runs clamp the extent to it (§11.4). [D] */
  demoExtentM: DEMO_EXTENT_M,
  /** Cell of the high-resolution DEM that travels as `terrainHiRes` and is block-averaged to the fire grid (m). [D] */
  hiResCellM: 10,
  /** Default fire cell (m) and the High-detail cell, allowed only for extents ≤ highDetailMaxExtentM (§11.6, §12.6). [D] */
  fireCellM: 30,
  highDetailCellM: 20,
  highDetailMaxExtentM: 6000,
  /** Sub-cell slope above which a 10 m cell counts as cliff (Terrain.cliffFraction contract). [D] */
  cliffSlopeDeg: 60,
  /** Percentile of the 10 m sub-cell slopes reported as slopeP90Deg. [D] */
  slopePercentile: 0.9,
  /** Default simulated duration (s) (§11.6 defaults). [D] */
  defaultDurationS: 4 * 3600,
  /**
   * When no elevation source is available (offline, away from demo sites and area packs) build a synthetic terrain
   * with a prominent warning instead of failing. [H] DEVIATION: spec §11.6 says "error (no synthetic terrain for real
   * sites)"; the orchestration brief requires offline builds never to fail. Set false to restore the spec behaviour.
   */
  syntheticTerrainFallback: true,
  syntheticTerrainKind: 'escarpment' as 'escarpment' | 'gorge' | 'ridges',

  // ───────────────────────────── weather (§11.1, §11.2) ─────────────────────────────
  /** Forecast request window (days) for now / forecast modes [V doc 08b §5]; forecast_days is raised to cover t0 + duration. */
  forecastPastDays: 7,
  forecastDays: 7,
  /** Open-Meteo limits: forecast_days ≤ 16, past_days ≤ 92 [V doc 08b; spec §11.1]. */
  maxForecastDays: 16,
  maxPastDays: 92,
  /** Past starts on/after this date use the historical-forecast API (ecmwf_ifs), earlier ones ERA5 [H, spec §11.1]. */
  historicalForecastFromMs: Date.UTC(2016, 0, 1),
  /** Hours of weather kept before t0 (moisture spin-up window, §5.6). [D] */
  spinupHours: 168,
  /** Hours of weather kept after t0 + duration (interpolation margin). [H] */
  tailHours: 3,
  /** Isolated nulls are interpolated across gaps of at most this many hours (§11.2). [H] */
  maxGapHours: 3,
  /** Clearness clamp k_t ≤ 1.2 and the clear-sky GHI below which k_t is copied from the nearest daylight hour (§11.2). [H] */
  clearnessMax: 1.2,
  clearSkyMinGhi: 20,
  /** Linke turbidity of the clear-sky model used for k_t (terrain/solar default). [K] */
  linkeTurbidity: 3,
  /** upperAirSource = 'model' when at least this many pressure levels are complete (§11.2). [D] */
  minPressureLevels: 3,
  /** On HTTP 429: wait this long, up to `rateLimitRetries` times, then use cache / stale (§11.1). [H doc 08b §5] */
  rateLimitBackoffMs: 60_000,
  rateLimitRetries: 3,
  /**
   * A cached response is accepted offline when it covers [t0 − minCachedSpinupHours, t0 + min(duration,
   * minWeatherAfterStartH)]. [H] DEVIATION: the spec asks for [t0 − 7 d, t0 + duration]; a forecast cached a day earlier
   * would never qualify, so 24 h (stable-night spin-up) is required and a warning is added when fewer than 7 days
   * precede t0; a response ending before t0 + duration clamps the duration (warning) instead of being rejected.
   */
  minCachedSpinupHours: 24,
  /** Least weather (h) any accepted live / cached response must hold after t0 (and the shortest clamped duration). [H] */
  minWeatherAfterStartH: 1,
  /**
   * Preset used when a live-weather mode (now / forecast / past) cannot get any weather offline. [H] DEVIATION: the spec
   * fails with "offline: choose a preset, manual entry or a replay"; the orchestration brief requires offline builds to
   * succeed. null restores the spec behaviour (throw).
   */
  offlineWeatherFallbackPreset: 'hot-nw-sw-change' as string | null,
  /** Days of daily history for KBDI / DF (§5.7). [D] */
  historyDays: 365,
  /** Years of daily precipitation averaged for the annual rainfall (§5.7, cached forever per site). [H] */
  annualRainfallYears: 10,
  /** Rounding (deg) of the site key under which the 10-year rainfall is cached. [H] */
  annualRainfallKeyDeg: 0.05,
  /** Below this many days of daily history KBDI / DF are not computed from it (drought defaults instead). [H] */
  minHistoryDays: 60,
  /** Drought defaults when no history is available (§11.5, §11.6). [H] */
  defaultDf: 7,
  defaultKbdi: 60,
  /**
   * Mean annual rainfall (mm) of the demo sites [K, UNVERIFIED approximations of BoM climatology, spec §5.7]. Used
   * offline, for replays and when the 10-year archive is unavailable.
   *
   * `tomah` is not an approximation of the Bureau's climatology: it is the Open-Meteo ERA5 archive mean of the 10 years 2016-2025
   * (the same method as the live request, annualRainfallFromDaily) at the grid point nearest the site, -33.497 150.371 at 819 m:
   * 1099 mm, read 2026-10-07 and rounded to the nearest 50 mm [H, UNVERIFIED]. ERA5's 0.25° grid reads mountain rain low (the same
   * method gives 1006 mm for Katoomba against the 1400 mm above), so Tomah's figure is on the low side.
   */
  demoAnnualRainfall: Object.freeze({
    katoomba: 1400,
    grose: 1100,
    tomah: 1100,
    kanangra: 900,
    thredbo: 1500,
    gospers: 750,
    budawangs: 1250,
    barrington: 1300,
    warrumbungles: 750,
  }) as Readonly<Record<string, number>>,
  /** Civil time zone of NSW data (display, daily history). [D] */
  timezone: 'Australia/Sydney',

  // ───────────────────────────── presets (§11.3) ─────────────────────────────
  /** Hours of preset weather generated before the start (moisture spin-up). [H] */
  presetSpinupHours: 72,
  /** Change blend time constant τ of f = logistic((t − t_c)/τ) (§11.3: 10–90 % in 33 min). [H] */
  presetChangeTauMin: 7.5,
  /**
   * Half-width W of the change blend: f is renormalised so it is exactly 0 at t_c − W and 1 at t_c + W. [H] DEVIATION
   * (tiny): the plain logistic still mixes 1.8 % of the post-change wind 30 min before t_c, which would raise the
   * hot-nw 14:30 "pre-change" chip wind from the stated 10.96 to 10.98 m/s, veer it 1.4° and move its FFDI from 62.6 to
   * 62.7. With W = 30 min the chip hour is exactly pre-change; 10–90 % takes 31 min instead of 33.
   */
  presetChangeHalfWidthMin: 30,
  /** Extra stamps every 10 min inside [t_c − 1 h, t_c + 2 h] (§11.3). [D] */
  presetChangeStampMin: 10,
  presetChangeWindowBeforeH: 1,
  presetChangeWindowAfterH: 2,
  /** Preset upper-air levels: heights (m ASL) and wind factors on the day surface wind (§11.3). [H] */
  presetLevels: Object.freeze([
    { hPa: 850, height: 1500, windFactor: 1.3 },
    { hPa: 700, height: 3100, windFactor: 1.6 },
    { hPa: 500, height: 5800, windFactor: 2.0 },
  ]),
  /** T500 = T700 − 20 K (§11.3). [H] */
  presetT500Drop: 20,
  /** Dry-adiabatic lapse (K/km) that bounds the preset column from below (non-superadiabatic, D46). [K] */
  dryAdiabaticKPerKm: 9.8,

  // ───────────────────────────── replays (§11.4) ─────────────────────────────
  /** Default replay start (LMST hour) and the minimum weather kept after a user-moved start (h). [D] */
  replayDefaultStartLmst: 10,
  replayMinWeatherAfterH: 4,

  // ───────────────────────────── belt kit and manual entry (§11.5) ─────────────────────────────
  /** Psychrometer A = 6.53e-4·(1 + 9.44e-4·T_w) K⁻¹ [V KNMI form, doc 04 §3.10; D38]. */
  psychroA: 6.53e-4,
  psychroB: 9.44e-4,
  /**
   * Kit wind (~2 m) → 10 m open wind by exposure [V FBI-TG Table 3.4 10:8 / 10:6 / 10:4.2, doc 03 §2.2; D39]; the
   * default exposure 'open' needs instructor confirmation (§16 item 18, UNVERIFIED as a default).
   */
  beltWindRatio: Object.freeze({ open: 1.25, woodland: 1.67, forest: 2.4 }),
  /** Belt-kit offset on a forecast: full over [t_r − lead, t_r], then linear decay to 0 over 3 h (§11.5; lead [H]). */
  beltOffsetDecayH: 3,
  beltOffsetLeadH: 1,
  /** Radius of the WindEdit created from a belt-kit reading (m) (§11.5). [D] */
  beltWindEditRadiusM: 1000,
  /**
   * Lapse rates used to bring the forecast to the reading's elevation (K/km) [K verify: ISA 6.5, dew point ≈ 1.8 (§5.2)].
   * The T rate is the fallback when the domain relief is unknown; builds use the D43 rate of fuel/moisture.
   */
  lapseTKPerKm: 6.5,
  lapseTdKPerKm: 1.8,

  // ───────────────────────────── vegetation, fire history, live feeds (§11.6, §11.7) ─────────────────────────────
  /** ArcGIS query paging and generalisation [V doc 08b §3–4]. */
  arcgisPageSize: 1000,
  svtmMaxPages: 8,
  svtmMaxAllowableOffset: 0.0002,
  svtmGeometryPrecision: 5,
  fireHistoryMaxAllowableOffset: 0.00005,
  fireHistoryGeometryPrecision: 6,
  fireHistoryMaxPages: 4,
  /** Margin (m) added around the domain for vector queries (doc 08b §4 used 100–300 m). [H] */
  queryMarginM: 300,
  /** Incidents / hotspots shown within this distance of the domain centre (m). [H] */
  contextRadiusM: 60_000,
  hotspotsMaxFeatures: 500,
  /** Grid of the canopy stored in an area pack (m). [H] */
  packCanopyCellM: 20,
  /**
   * Places context (roads, fire trails, homes, zones, place names; scenario/context.ts). A cached live result is used
   * without asking the services again for this many days [D, spec brief]; an older one is used only when the services
   * cannot be reached. The live query stops waiting after `contextLiveTimeoutMs` and keeps the layers that have arrived
   * (measured 2026-09-29: the zoning server needs 10-20 s for a 6 km area, the others 1-3 s); the build carries on with
   * a warning naming what is missing. [H]
   */
  contextFreshDays: 7,
  contextLiveTimeoutMs: 45_000,
  /** The slow remote canopy (CHM COG) path is tried only for extents up to this (m) (data/ MAX_REMOTE_CANOPY_EXTENT). [D] */
  remoteCanopyMaxExtentM: 3000,
});

export type ScenarioParams = typeof SCENARIO_PARAMS;
export type BeltExposure = keyof typeof SCENARIO_PARAMS.beltWindRatio;

/** Mean annual rainfall of a demo site (mm) from the bundled table, or undefined. */
export const demoAnnualRainfall = (siteId: string | undefined): number | undefined =>
  siteId ? SCENARIO_PARAMS.demoAnnualRainfall[siteId] : undefined;

/**
 * The fire cell the builder really uses (§11.6, §12.6; scenario/build.ts `resolveRequest`): 20 m only when High detail
 * was asked for (a requested cell of 20 m or less, or the High tier) AND the extent is at most 6 km; otherwise 30 m. Any
 * other requested size (e.g. 40 m) builds 30 m cells: the engine's calibrations (level-set viscosity, VLS slope
 * thresholds, landform classes, ember emission per cell) are made and tested at 20-30 m (spec §2.1). `coarsened` says
 * that High detail was asked for but the area is too large for it.
 */
export function builtFireCell(extentM: number, requestedCellM?: number, tier?: string): { cellM: number; coarsened: boolean } {
  const P = SCENARIO_PARAMS;
  const wantsHigh = (requestedCellM !== undefined && requestedCellM <= P.highDetailCellM) || tier === 'high';
  if (!wantsHigh) return { cellM: P.fireCellM, coarsened: false };
  return extentM <= P.highDetailMaxExtentM ? { cellM: P.highDetailCellM, coarsened: false } : { cellM: P.fireCellM, coarsened: true };
}
