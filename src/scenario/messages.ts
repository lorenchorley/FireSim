/**
 * User-visible build warnings of the scenario builder (spec §11.6: "exact strings in scenario/messages.ts").
 * Warnings are non-fatal: the build continues with the stated fallback. Fire-history warnings (undated fires, fires
 * active at the start, no fire record) come verbatim from fuel/ (`rasteriseFireHistory`), which owns the §4.4 rule.
 */
export const MESSAGES = Object.freeze({
  vegetationInferred: 'Vegetation inferred from terrain (no vegetation map for this area): fuel types are estimates.',
  vegetationPartial: 'The vegetation map covers only part of the area; fuel elsewhere is inferred from terrain.',
  noFireRecord: 'No fire record: steady-state fuel assumed',
  fireHistoryUnavailable: 'Fire history unavailable: steady-state fuel assumed (no recent burns).',
  fireHistoryPartial: 'Fire history covers only part of the area; elsewhere steady-state fuel is assumed.',
  syntheticUpperAir: 'No upper-air data for this weather: a synthetic temperature profile is used and C-Haines is unavailable.',
  weatherModelFallback: (model: string): string => `Weather model fallback used: ${model}.`,
  pressureLevelFallback: (model: string): string => `Upper-air (pressure-level) data from ${model}.`,
  kbdiShortHistory: (days: number): string => `KBDI from ${days} days of rainfall history (< 365): drought may be under-read.`,
  dailyGapFilled: (days: number): string => `Daily rainfall history gap-filled from the forecast for the last ${days} day${days === 1 ? '' : 's'}.`,
  dailyGapDefaulted: (days: number): string => `${days} day${days === 1 ? '' : 's'} of rainfall history missing: assumed dry.`,
  canopyUnavailable: 'Canopy unavailable (type defaults)',
  canopyPartial: 'Canopy height measured on only part of the area (type defaults elsewhere).',
  droughtDefaults: 'Drought defaults used (drought factor 7, KBDI 60): enter the local drought factor if known.',
  kbdiFromDf: (df: number, kbdi: number): string => `KBDI ${kbdi.toFixed(0)} inferred from the entered drought factor ${df.toFixed(1)} (no recent rain assumed).`,
  annualRainfallTable: (mm: number): string => `Annual rainfall ${mm.toFixed(0)} mm from the demo-site table.`,
  annualRainfallEstimated: (mm: number): string => `Annual rainfall unknown: estimated ${mm.toFixed(0)} mm from the last year.`,
  syntheticTerrain: 'No elevation data offline for this location: SYNTHETIC TERRAIN is used (not the real place). Connect, download an area pack, or pick a demo site.',
  terrainFromPack: (name: string): string => `Terrain from area pack '${name}'.`,
  extentClamped: (km: number, why: string): string => `Area limited to ${km} km (${why}).`,
  cellCoarsened: (m: number): string => `Fire grid ${m} m (20 m detail needs an area of 6 km or less).`,
  offlineWeather: 'offline: choose a preset, manual entry or a replay',
  offlineWeatherFallback: (preset: string): string => `Offline and no stored weather covers this time: using the '${preset}' preset instead (choose a preset, manual entry or a replay).`,
  weatherUnavailableFallback: (preset: string): string =>
    `No usable forecast from the weather service for this time and nothing stored: using the '${preset}' preset instead (choose a preset, manual entry or a replay).`,
  staleWeather: (hoursOld: number): string => `Offline: using weather stored ${hoursOld.toFixed(0)} h ago.`,
  shortSpinup: (hours: number): string => `Only ${hours.toFixed(0)} h of weather before the start (moisture spin-up shortened).`,
  durationClamped: (hours: number): string => `Duration limited to ${hours.toFixed(1)} h by the available weather.`,
  replayStartClamped: 'Replay start moved to keep at least 4 h of weather after it.',
  manualNoCloud: 'No cloud cover entered: clear sky assumed.',
  // Places context (roads, fire trails, homes, zones, place names). Plain English for the Setup / build screens.
  contextOffline: 'Roads and homes are not available offline for this place — save an area pack in Setup while you have signal',
  contextFailed: 'Roads, homes and place names could not be loaded (the map service did not answer): try again with signal, or save an area pack in Setup.',
  contextTimedOut: (s: number): string => `Roads, homes and place names took longer than ${s} s to load and were left out: try again with a better signal, or save an area pack in Setup.`,
  contextSlow: (layers: string, s: number): string => `Some map data (${layers}) took longer than ${s} s to load and was left out: try again with a better signal, or save an area pack in Setup.`,
  contextMissing: (layers: string): string => `Some map data could not be loaded (${layers}): those layers will be empty.`,
  contextStale: (date: string): string => `Roads and homes are from a copy saved on ${date}: they could not be refreshed.`,
  contextPartial: 'Roads and homes cover only part of this area (the bundled map of the demo site ends before the edge).',
  networkFailed: (layer: string): string => `${layer}: network unavailable, using the next source.`,
  rateLimited: (s: number): string => `Weather service busy (rate limit): retrying in ${s} s.`,
  beltKitRejected: (why: string): string => `Belt-kit reading ignored: ${why}`,
  forecastBeltOffset: (dT: number, dTd: number): string =>
    `Belt-kit reading applied: forecast adjusted by ${dT >= 0 ? '+' : ''}${dT.toFixed(1)} °C, dew point ${dTd >= 0 ? '+' : ''}${dTd.toFixed(1)} °C (fading over 3 h).`,
});
