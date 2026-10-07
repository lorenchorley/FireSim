/**
 * Tunable constants of the insight engine (spec docs/research/00-synthesis.md §10, §0.1).
 *
 * Every [H] (FireSim heuristic / design choice) and UNVERIFIED number of §10 lives here, never inline. Published
 * thresholds that the spec tags [V]/[K] are also kept here (with their tag) so the whole card registry can be reviewed
 * by NSW RFS instructors in one place (§16 item 19). Units: SI unless the name says otherwise (…Kmh, …Deg, …Pp).
 */

export const EXPLAIN_PARAMS = Object.freeze({
  /** §10.1 engine rules [H doc 10 §9.1, doc 09 §11.1]. */
  engine: Object.freeze({
    /** Detector cadence (simulated seconds). */
    cadenceS: 60,
    /** Spatial card tile size (m): key = kind:tileX:tileY. */
    tileM: 500,
    /** Default persistence: detector cycles with score ≥ 1 before a card is shown. */
    persistence: 2,
    /** Default cool-down (s) after a card turns off. */
    cooldownS: 900,
    /** Hysteresis: a shown card stays active while score ≥ this. */
    hysteresis: 0.8,
    /** At most this many new insights per detector cycle. */
    maxNewPerCycle: 3,
    /**
     * [H, FireSim addition] A new key of a kind already shown within this distance (m) during the last cool-down is
     * suppressed unless its severity is higher (stops a moving head re-raising the same card in every 500 m tile).
     */
    dedupRadiusM: 1000,
    /** Spatial hash bucket (m) for front-cell proximity queries. */
    hashBucketM: 250,
    /** Head cells = front cells with aux.direction ≥ this (§10.1). */
    headDirectionMin: 0.8,
    /**
     * [H performance] Per-front detectors examine at most this many front cells (strided sample above it; count
     * thresholds scale with the stride). Realistic fronts (≤ 6000 cells ≈ 180 km of perimeter at 30 m) are exact.
     */
    maxFrontExamined: 6000,
    /** Ratio caps of the soft-AND scores (score = min of per-condition ratios, each capped here). */
    ratioCap: 2,
  }),

  /** Notes appended to card bodies (§10.1). */
  notes: Object.freeze({
    /** Add "(steeper than the tested range, so it could be faster)" above this slope (deg) [V model range, D4]. */
    steepDeg: 20,
    /** Add "the model can't see this precisely" when a sub-grid term is above this share of ROS or wind. */
    subgridShare: 0.3,
  }),

  /** upslope-run [H doc 10 S01]. */
  upslope: Object.freeze({ minCells: 5, maxAngleDeg: 45, minSlopeDeg: 10, minRosMs: 0.05, watchSlopeDeg: 20 }),

  /** downslope-backing + variants S43 (narrow gully floor) and S10 (strong downslope wind) [H doc 10]. */
  downslope: Object.freeze({
    minCells: 5,
    maxAngleDeg: 45,
    maxSlopeDeg: -10,
    maxWindAlongKmh: 10,
    s43FloorDistM: 50,
    s43OppositeWallDeg: 15,
    /** Distance (m) across the floor at which the opposite wall's mean slope is sampled. */
    s43WallSampleM: 150,
    s10MinWindKmh: 25,
    s10MinSlopeDeg: 10,
    s10MaxMoisture: 8,
    s10MinCells: 2,
  }),

  /** gully-chimney [H doc 10 S03, doc 02 card 11]. */
  gully: Object.freeze({
    minAxialSlopeDeg: 20,
    maxTpiSmall: -10,
    minTrench: 0.3,
    baseDistM: 200,
    maxWindAngleDeg: 45,
    /** Anabatic alternative: Q_h (W/m²) and U_ridge,median (m/s). */
    anabaticQh: 150,
    anabaticMaxURidge: 5,
    dangerAttach: 0.5,
    /** Minimum qualifying (steep, deep) drainage cells for a segment to count. */
    minSteepCells: 2,
  }),

  /** eruptive-slope; the attachment score A mirrors §7.6 (D33: logistic centred at 22°, card at A ≥ 0.5) [H]. */
  eruptive: Object.freeze({
    maxAngleDeg: 30,
    minA: 0.5,
    runM: 60,
    minCells: 2,
    attachCentreDeg: 22,
    attachWidthDeg: 6,
    trenchFloor: 0.4,
    alignFullDeg: 60,
    alignHalfDeg: 120,
    alignWindKmh: 10,
    dangerAE: 0.5,
    dangerG: 1.5,
    /** G_max of §7.6 (user 1.5–4; default 2.5) [H]. */
    gMax: 2.5,
    /** Indraft s_res scale (m/s) of §7.6. */
    indraftScale: 3,
  }),

  /** ridge-crest [H doc 10 S08]. */
  ridgeCrest: Object.freeze({ distM: 150, minURidgeKmh: 15, maxAngleDeg: 60, normalRadiusM: 90 }),

  /** lee-slope-eddy [D24/D25; H]. */
  leeEddy: Object.freeze({ minSep: 0.5, aheadM: 500, minCells: 3 }),

  /** vorticity-lateral-spread (P1) [D22–D23]. */
  vls: Object.freeze({ minVls: 0.5, lookM: 1000, minURidge: 5, minCells: 2, lateralCells: 1 }),

  /** saddle-channelling [H doc 10 S04]. */
  saddle: Object.freeze({ distM: 1000, maxAngleDeg: 45, minURidgeKmh: 15 }),

  /** valley-channelling [H doc 02 card 5]. */
  valley: Object.freeze({
    minReliefM: 150,
    fireDistM: 2000,
    minDiffDeg: 45,
    /** Floor wind (m/s) below which the direction is too variable to compare [H]. */
    minFloorWindMs: 1,
    /** Valley-floor cells: heightAboveValley ≤ this (m) or Landform.ValleyFloor. */
    floorHavM: 30,
    minCells: 3,
  }),

  /** ridge-speed-up (P1) [K Jackson & Hunt 1975; H thresholds]. */
  ridgeSpeedUp: Object.freeze({ fireDistM: 1000, minSpeedUp: 0.25, upwindM: 1000, minCrestWindMs: 2 }),

  /** spotting [H doc 10 S20]. */
  spotting: Object.freeze({ aheadM: 500, minBark: 3, minU10Kmh: 30, maxMoisture: 7, minCells: 3 }),

  /** spot-fire (cool-down 10 min per tile). */
  spotFire: Object.freeze({ minDistM: 200, watchDistM: 1000, cooldownS: 600 }),

  /** mass-spotting [H]. */
  massSpotting: Object.freeze({ minCount: 10, windowS: 1800, radiusM: 2000 }),

  /** junction-zone [H doc 10 S29; geometry D]. */
  junction: Object.freeze({
    maxGapM: 300,
    faceAngleDeg: 45,
    maxAlphaDeg: 45,
    watchAlphaDeg: 60,
    watchGapM: 200,
    /** At most this many front cells are probed per cycle (strided) [H performance]. */
    maxProbe: 3000,
    factorCap: 6,
  }),

  /** wind-change (forecast §10.3 or live) [H doc 10 S11]. */
  windChange: Object.freeze({
    minShiftDeg: 45,
    minPostKmh: 15,
    horizonS: 3 * 3600,
    mergeS: 2 * 3600,
    flankAngleDeg: 45,
    /** The card stays active this long after the change time. */
    holdAfterS: 1200,
  }),

  /** dead-man-zone (P1) and the §10.5 DMZ overlay [H doc 10 §9.3]. */
  dmz: Object.freeze({ horizonS: 3600, minutes: 5, gridM: 60, refreshS: 300, minCells: 1 }),

  /** plume-dominated [V N_c ≥ 10 doc 02; H length/persistence]. */
  plume: Object.freeze({ minNc: 10, minLengthM: 200, persistence: 5 }),

  /** pyroconvection-risk [V Di Virgilio 2019 thresholds; H plume-top margin]. */
  pyro: Object.freeze({ watchCH: 8, watchFfdi: 25, dangerCH: 10, dangerFfdi: 50, lclMarginM: 500 }),

  /**
   * fire-induced-wind (P1) [H doc 07]. minAbsMs 1.0 (registry 1.5) [H, deviation]: with the §8.8 pyrogenic calibration
   * (u_in = k·I/2, k 6e-4) 1.5 m/s is the indraft beside an infinite 5 MW/m strip, so V15's plume-dominated
   * 5–7 MW/m fronts (1.0–1.6 m/s at a 1.4 km line) never reached it on 30 % of the front. minAgeS: front cells that
   * arrived within this time are skipped, their U_fireInd dates from before arrival (the head correction of the
   * unburnt cells ahead of the front, §8.8).
   */
  fireWind: Object.freeze({ minShare: 0.3, minAbsMs: 1.0, relBg: 0.3, persistence: 5, minAgeS: 60 }),

  /** anabatic-wind [H doc 02 card 3]. */
  anabatic: Object.freeze({
    minQh: 150,
    minSlopeDeg: 10,
    minUpslopeMs: 1,
    maxURidgeMs: 5,
    lmstStart: 9,
    lmstEnd: 17,
    fireDistM: 1000,
    minCells: 3,
  }),

  /** katabatic-wind + S17 evening flip [H doc 02 card 4, doc 10 S17]. */
  katabatic: Object.freeze({
    maxSunDeg: 5,
    minSlopeDeg: 5,
    minGate: 0.5,
    fireDistM: 1000,
    minCells: 3,
    s17SunsetWindowS: 5400,
    s17LagS: 7200,
    s17MinTurnDeg: 90,
    /** Minimum mean front wind (m/s) for a direction to count in S17. */
    s17MinWindMs: 0.5,
  }),

  /** thermal-belt + "ridges don't sleep" [D26; H doc 10 S16, doc 02 card 7]. */
  thermalBelt: Object.freeze({
    minDTheta: 3,
    bandM: 75,
    dTWarmer: 2,
    dRhDrier: 10,
    floorRadiusM: 1000,
    floorHavM: 20,
    ridgeMinURidgeKmh: 15,
    minCells: 2,
  }),

  /** inversion-break [H doc 10 S15, doc 02 cards 8/19/23]. */
  inversion: Object.freeze({ minDTheta: 3, breakWithinS: 3600, brokenDTheta: 1, wetRain24Mm: 2, smokeMaxSunDeg: 15 }),

  /** aspect-dry-fuel + S38 forces aligned [H doc 10 S18/S38]. */
  aspectDry: Object.freeze({
    minSlopeDeg: 10,
    /** North-facing sector (aspect, clockwise through north). */
    northFrom: 300,
    northTo: 60,
    /** West-facing sector, after `westAfterLmst`. */
    westFrom: 240,
    westTo: 300,
    westAfterLmst: 12,
    minDrierPp: 1.5,
    oppositeRadiusM: 1000,
    /** Opposite aspect = within this of aspect + 180°. */
    oppositeHalfWidthDeg: 45,
    s38AngleDeg: 45,
    s38MinWindKmh: 5,
    s38AfternoonLmst: 12,
    minCells: 2,
  }),

  /** moist-gully [H]. */
  moistGully: Object.freeze({ fireDistM: 300, wetterPp: 3, faRatio: 0.5, droughtKbdi: 150, droughtFa: 0.8, maxTpiSmall: -5, minCells: 2 }),

  /** heavy-fuel [V FuelFlag.HeavyFuel definition §4.7; H watch height]. */
  heavyFuel: Object.freeze({ fhsS: 3.5, bark: 3, fhsEl: 3, watchFlameM: 10, minCells: 2 }),

  /** recent-burn [H doc 10 S39]. */
  recentBurn: Object.freeze({ maxYears: 5, distM: 500 }),

  /** crown-fire [V AFDRS-RP Tables 2.9–2.11 thresholds]. */
  crown: Object.freeze({ iCrown: 10000, iGate: 4000, fhRatio: 0.66, cfb: 0.5, minCells: 2 }),

  /** high-drought [H]. */
  drought: Object.freeze({ df: 9, kbdi: 150 }),

  /** night-slowdown [H]. */
  nightSlow: Object.freeze({ rosRatio: 0.5, moistureRisePp: 3 }),

  /** afternoon-peak and its S13 hot-dry-windy variant [H doc 10 S13/S14; V FBI ≥ 50 = Extreme]. */
  afternoon: Object.freeze({
    lmstStart: 13,
    lmstEnd: 17,
    windowH: 1,
    /** Hours of the day searched for the minimum M_A (LMST). */
    searchStart: 10,
    searchEnd: 19,
    s13DirFrom: 270,
    s13DirTo: 340,
    s13MinKmh: 30,
    s13MaxRh: 20,
    s13MinT: 32,
    s13Fbi: 50,
  }),

  /** fuel-break-breached [V Wilson 1988 formula (§7.4); H spot-break width]. */
  breach: Object.freeze({ minSpotBreakM: 10, canopyCover: 0.3, canopyRadiusM: 20, bTrees: 0.38, bOpen: 0.99 }),

  /** rolling-debris (P1). */
  debris: Object.freeze({ windowS: 600 }),

  /** general sub-notes. */
  general: Object.freeze({
    steepShare: 0.1,
    steepSlopeDeg: 20,
    embersExitShare: 0.05,
    windDrivenMaxNc: 2,
    windDrivenMinKmh: 20,
    lightWindMaxKmh: 5,
    lightWindPersistence: 10,
    lightWindShare: 0.5,
    narrowGullySlopeDeg: 25,
    /** Atmosphere Δx_a (m) assumed when the view carries no atmosphere grid (standard tier default). */
    atmosCellDefaultM: 200,
    narrowGullySearchM: 300,
    mountainWaveCrossShare: 0.3,
    mountainWaveFrLo: 0.6,
    mountainWaveFrHi: 1.2,
    mountainWaveSn: 0.5,
    mountainWaveURidge: 10,
    foehnDirFrom: 250,
    foehnDirTo: 320,
    foehnMinMs: 15,
  }),

  /** §10.3 forecast analysis. */
  forecast: Object.freeze({
    /** Post-window extension (h) beyond the scenario end. */
    extraHours: 3,
    /** DF assumed for the hourly FFDI when the series carries none [H conservative]. */
    defaultDf: 10,
  }),

  /** §10.5 safety overlays (P1). */
  safety: Object.freeze({
    /** Tobler v = 6·exp(−3.5|tanθ + 0.05|) km/h [V Tobler 1993]. */
    toblerBase: 6,
    toblerK: 3.5,
    toblerOffset: 0.05,
    /** Off-track factor [L doc 10 §9.3] and PPE/load factor [H]. */
    offTrack: 0.6,
    load: 0.8,
    /** Refuge = 4 × flame height [V LACES]; IRPG doubling above 11° approach slope or 16 km/h wind [V]. */
    refugeMultiple: 4,
    doublingSlopeDeg: 11,
    doublingWindKmh: 16,
  }),
});

export type ExplainParams = typeof EXPLAIN_PARAMS;

/**
 * Sites east (lee) of the Great Dividing Range for the foehn note (spec §10.2 general/foehn) [H, UNVERIFIED].
 * Demo sites use the flag; other locations are tested against the coarse divide polyline below.
 */
export const LEE_OF_DIVIDE: Readonly<Record<string, boolean>> = Object.freeze({
  katoomba: true,
  grose: true,
  tomah: true,
  gospers: true,
  kanangra: true,
  budawangs: true,
  barrington: true,
  thredbo: true,
  warrumbungles: false,
});

/** Coarse Great Dividing Range line (lat, lon), north to south [H, UNVERIFIED] (spec §10.2 foehn). */
export const DIVIDE_LINE: readonly (readonly [number, number])[] = Object.freeze([
  [-28.3, 152.2],
  [-30.0, 151.6],
  [-31.5, 151.1],
  [-32.0, 150.4],
  [-33.0, 150.0],
  [-34.0, 150.0],
  [-35.0, 149.6],
  [-36.0, 149.1],
  [-36.8, 148.2],
] as const);
