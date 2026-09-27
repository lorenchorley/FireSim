/**
 * Object API of the point fire-behaviour models (spec §6.1): `fireBehaviour(input)` dispatches on the fuel **class**
 * family (`FUEL_CLASSES[input.fuelClass ?? type]`), and `vestaMk2`, `grassland`, `heath`, `pine` force one model.
 * Used by explain/, tests and the UI; fire/spread uses the kernel API instead (`headRosKernel`, `intensityKernel`).
 *
 * Output (contract names, `FireBehaviourOutput`): `rosHead` = R_w·SF(slopeDeg) (m/s; vesta2/pine capped at 15 km/h,
 * D4), `rosBack` = min(R_H, max(cb·R_w, R0)·SF(−θ)), `rosFlank` = h·R_w (§7.4 with the head along the fall line, so
 * the cross-slope directional slope is 0), `lengthBreadth` from U10 (§6.8), `fuelConsumed` = the §6.9 intensity fuel,
 * `intensity`, `flameHeight`, `spottingDistance` (§6.10), `phase`, `factors` (§6.12), `fbi`/`rating` of this model's
 * own intensity (the displayed AFDRS FBI is `afdrsFbi`, D41) and `validated` (§6.12).
 *
 * Inputs: `windSpeed10` m/s (converted to km/h here), `deadFuelMoisture` %, hazards 0–4, heights m. Layer loads come
 * from `surfaceLoad`/`nearSurfaceLoad`/`elevatedLoad` when given; otherwise the type's steady-state row is scaled so
 * that s + ns + el = `fineFuelLoad` (the legacy total). Availability: `fuelAvailability` override, else Mk2 FA_dry(DF)
 * (forest), FA_wet(C1(KBDI, wrf)·DF) (wet forest, pine; KBDI default 100 [H]), 1 (grass, heath).
 */
import { FuelType, type CellFuelParams, type FireBehaviourInput, type FireBehaviourOutput, type FuelFamily, type SpreadFactors } from '../../core/types';
import { BYRAM, flameHeightVesta, fuelAvailabilityAfdrs, fuelAvailabilityMk2, fuelAvailabilityWet, slopeFactor, slopeFactorCapped, wetC1OutOfDomain } from './common';
import { createReferenceFactorsOut, referenceFactors } from './factors';
import { fbiFromMetric, fbiTableFor, fbiTables, ratingFromFbi } from './fbi';
import { classOverrides, fuelRow, grassWafFor } from './fuelRef';
import { grassPhiM, grassStateFromLoad } from './grass';
import { heathRefitRos, heathV1Ros, heathWaf } from './heath';
import { createHeadKernelOut, createIntensityOut, headRosKernel, intensityKernel } from './kernel';
import { ffdi, mk5 } from './mcarthur';
import { FIRE_MODEL_PARAMS, getFireModelOptions, setFireModelOptions, type FireModelOptions } from './params';
import { createEllipseCoeffs, ellipseCoefficients, lengthToBreadth, lbForest } from './shape';
import { spottingEnvelope } from './spotting';
import { vesta2012PhiM, vesta2012R0, vesta2012Ros } from './vesta2012';
import { mk2PhiM } from './vestaMk2';

const MODEL_NAMES: Record<FuelFamily, string> = {
  vesta2: 'Vesta Mk2',
  grass: 'CSIRO grassland',
  heath: 'AFDRS heath',
  pine: 'AFDRS pine',
  none: 'none',
};

/** Build the CellFuelParams of an object-API input (optionally forcing a model family). Allocates. */
export function cellParamsFromInput(input: FireBehaviourInput, familyOverride?: FuelFamily): CellFuelParams {
  const type = input.fuelType;
  const cls = input.fuelClass ?? type;
  const row = fuelRow(type);
  const ov = classOverrides(cls);
  const family = familyOverride ?? ov?.family ?? row.family;
  const moistureFamily = familyOverride === 'pine' ? 'pine' : (ov?.moistureFamily ?? row.moistureFamily);
  let s = input.surfaceLoad;
  let ns = input.nearSurfaceLoad;
  let el = input.elevatedLoad;
  let scale = 1;
  if (s === undefined && ns === undefined && el === undefined) {
    const tot = row.s + row.ns + row.el;
    if (tot > 0 && Number.isFinite(input.fineFuelLoad) && input.fineFuelLoad >= 0) scale = input.fineFuelLoad / tot;
    s = row.s * scale;
    ns = row.ns * scale;
    el = row.el * scale;
  } else {
    s ??= row.s;
    ns ??= row.ns;
    el ??= row.el;
  }
  const cover = Number.isFinite(input.canopyCover) ? input.canopyCover : row.cover;
  const hO = Number.isFinite(input.canopyHeight) ? input.canopyHeight : row.hO;
  const wet = input.wetForest ?? moistureFamily === 'wetForest';
  return {
    type, fuelClass: cls, family,
    moistureFamily: family !== 'vesta2' ? moistureFamily : wet ? 'wetForest' : moistureFamily === 'wetForest' ? 'forest' : moistureFamily,
    surfaceLoad: s, nearSurfaceLoad: ns, elevatedLoad: el, barkLoad: input.barkLoad ?? row.bark * scale, canopyLoad: input.canopyLoad ?? row.canopy,
    fhsS: input.surfaceHazard, fhsNs: input.nearSurfaceHazard, fhsEl: input.elevatedHazard, barkHazard: input.barkHazard,
    hNs: input.nearSurfaceHeight, hEl: input.elevatedHeight, hO, hOEff: input.canopyHeightEff ?? row.hO, cover, lai: row.lai,
    wrf: input.wrf ?? ov?.wrf ?? row.wrf,
    grassState: input.grassState ?? ov?.grassState ?? row.grassState ?? grassStateFromLoad(s + ns),
    grassWaf: grassWafFor(type, cover), curing: input.curing, underWoodland: input.underWoodland ?? false, wetSubmodel: wet,
    spotting: ov?.spotting ?? row.spotting, barkClass: row.barkClass, tauF: row.tauF, receptivity: row.receptivity, cRef: row.cRef,
    faBlendW: 0, moistureOffset: 0, flags: 0, timeSinceFire: NaN,
  };
}

/** Fuel availability of an object-API input (spec §5.9 without the topographic blend). */
export function availabilityFor(input: FireBehaviourInput, p: CellFuelParams): number {
  if (input.fuelAvailability !== undefined) return input.fuelAvailability;
  const kbdi = input.kbdi ?? FIRE_MODEL_PARAMS.availability.defaultKbdi;
  if (p.family === 'pine') return fuelAvailabilityWet(input.droughtFactor, kbdi, p.wrf);
  if (p.family === 'vesta2') return p.moistureFamily === 'wetForest' ? fuelAvailabilityWet(input.droughtFactor, kbdi, p.wrf) : fuelAvailabilityMk2(input.droughtFactor);
  return 1;
}

/** Run `fn` with temporary model switches (restored afterwards). */
function withOptions<T>(opts: Partial<FireModelOptions> | undefined, fn: () => T): T {
  if (!opts) return fn();
  const saved = { ...getFireModelOptions() };
  setFireModelOptions(opts);
  try {
    return fn();
  } finally {
    setFireModelOptions(saved);
  }
}

const zeroFactors = (): SpreadFactors => ({ base: 0, wind: 1, moisture: 1, fuel: 1, slope: 1, terrain: 1, direction: 1, fireWindShare: 0 });

function evaluate(input: FireBehaviourInput, familyOverride: FuelFamily | undefined): FireBehaviourOutput {
  const p = cellParamsFromInput(input, familyOverride);
  const family = p.family;
  if (family === 'none') {
    return {
      rosHead: 0, rosBack: 0, rosFlank: 0, lengthBreadth: 1, fuelConsumed: 0, intensity: 0, flameHeight: 0, phase: 0, spottingDistance: 0,
      factors: zeroFactors(), model: MODEL_NAMES.none, ros0: 0, fuelAvailability: 0, fbi: 0, rating: ratingFromFbi(0), validated: true,
    };
  }
  const u10 = 3.6 * (input.windSpeed10 > 0 ? input.windSpeed10 : 0);
  const m = input.deadFuelMoisture;
  const df = input.droughtFactor;
  const fa = availabilityFor(input, p);
  const k = createHeadKernelOut();
  headRosKernel(p, u10, m, fa, k, df);

  const theta = input.slopeDeg ?? 0;
  const sf = slopeFactor(theta);
  let rH = k.rw * sf;
  let capped = false;
  if ((family === 'vesta2' || family === 'pine') && rH > FIRE_MODEL_PARAMS.forestCapMh) {
    rH = FIRE_MODEL_PARAMS.forestCapMh;
    capped = true;
  }
  const lb = lengthToBreadth(family, u10);
  const e = ellipseCoefficients(lb, createEllipseCoeffs());
  const rB = Math.min(rH, Math.max(e.cb * k.rw, k.r0) * slopeFactor(-theta));
  const rF = e.h * k.rw;

  const it = createIntensityOut();
  intensityKernel(p, rH, k.fa, it, df, k.rw > 0 ? k.rSurf / k.rw : 1);
  const spotting = p.spotting ? spottingEnvelope(rH, u10, p.fhsS) : 0;

  const rf = referenceFactors(p, u10, m, fa, createReferenceFactorsOut(), df);
  const product = rf.base * 3600 * rf.wind * rf.fuel * rf.moisture * sf;
  const factors: SpreadFactors = {
    base: rf.base, wind: rf.wind, moisture: rf.moisture, fuel: rf.fuel, slope: sf,
    terrain: product > 0 ? rH / product : 1, direction: 1, fireWindShare: 0,
  };

  const tableId = fbiTableFor(p.type, p.fuelClass, family);
  const table = tableId ? fbiTables(getFireModelOptions().fbiTables)[tableId] : null;
  const fbi = table ? fbiFromMetric(table.metric === 'ros' ? rH : it.intensity, table) : 0;

  const sl = FIRE_MODEL_PARAMS.slope;
  const c1Bad = (family === 'pine' || p.moistureFamily === 'wetForest') && input.fuelAvailability === undefined && wetC1OutOfDomain(p.wrf);
  const validated = k.valid === 1 && theta <= sl.validMaxDeg && theta >= sl.validMinDeg && !slopeFactorCapped(theta) && !capped && !c1Bad;

  const moistureFactor = family === 'vesta2' || family === 'pine' ? mk2PhiM(m) : family === 'grass' ? grassPhiM(m, u10) : undefined;
  const heathName = getFireModelOptions().heathModel === 'v1' ? 'AFDRS heath (FBI-TG v1.0)' : 'AFDRS heath (2024 refit)';
  const out: FireBehaviourOutput = {
    rosHead: rH / 3600,
    rosBack: rB / 3600,
    rosFlank: rF / 3600,
    lengthBreadth: lb,
    fuelConsumed: it.w,
    intensity: it.intensity,
    flameHeight: it.flameHeight,
    phase: k.phase,
    spottingDistance: spotting,
    factors,
    model: family === 'heath' ? heathName : MODEL_NAMES[family],
    ros0: k.r0 / 3600,
    fuelAvailability: k.fa,
    fbi,
    rating: ratingFromFbi(fbi),
    validated,
  };
  if (family === 'vesta2' || family === 'pine') {
    out.p2 = k.p2;
    out.p3 = k.p3;
  }
  if (moistureFactor !== undefined) out.moistureFactor = moistureFactor;
  return out;
}

/** Dispatch on the class family (spec §6.1). `opts` temporarily overrides the model switches. */
export function fireBehaviour(input: FireBehaviourInput, opts?: Partial<FireModelOptions>): FireBehaviourOutput {
  return withOptions(opts, () => evaluate(input, undefined));
}

/** Vesta Mk2 for any fuel input (forest family forced). */
export function vestaMk2(input: FireBehaviourInput, opts?: Partial<FireModelOptions>): FireBehaviourOutput {
  return withOptions(opts, () => evaluate(input, 'vesta2'));
}

/** CSIRO grassland for any fuel input (grass family forced). */
export function grassland(input: FireBehaviourInput, opts?: Partial<FireModelOptions>): FireBehaviourOutput {
  return withOptions(opts, () => evaluate(input, 'grass'));
}

/** Heath (2024 refit by default; `opts.heathModel = 'v1'` for FBI-TG v1.0), heath family forced. */
export function heath(input: FireBehaviourInput, opts?: Partial<FireModelOptions>): FireBehaviourOutput {
  return withOptions(opts, () => evaluate(input, 'heath'));
}

/** Pine plantation model (pine family forced). */
export function pine(input: FireBehaviourInput, opts?: Partial<FireModelOptions>): FireBehaviourOutput {
  return withOptions(opts, () => evaluate(input, 'pine'));
}

/** Both heath forms and whether the UI should show the "model spread" note (> 25 % difference, spec §6.6). */
export function heathModelSpread(input: FireBehaviourInput): { refit: number; v1: number; ratio: number; showSpread: boolean } {
  const waf = heathWaf(input.underWoodland ?? false);
  const u10 = 3.6 * input.windSpeed10;
  const refit = heathRefitRos(u10, input.deadFuelMoisture, input.elevatedHeight, waf) / 3600;
  const v1 = heathV1Ros(u10, input.deadFuelMoisture, input.elevatedHeight, waf) / 3600;
  const hi = Math.max(refit, v1);
  const ratio = hi > 0 ? Math.min(refit, v1) / hi : 1;
  return { refit, v1, ratio, showSpread: hi > 0 && 1 - ratio > FIRE_MODEL_PARAMS.heath.spreadNoteFraction };
}

/**
 * Vesta 2012 comparison model (spec §6.3, P1): AFDRS availability (0.1·DF; wet: min(FA_wet, 0.1·DF)) unless
 * `fuelAvailability` is given, forest LB, §6.9 intensity gating with FH from §6.2.
 */
export function vesta2012Behaviour(input: FireBehaviourInput): FireBehaviourOutput {
  const p = cellParamsFromInput(input, 'vesta2');
  const u10 = 3.6 * input.windSpeed10;
  const kbdi = input.kbdi ?? FIRE_MODEL_PARAMS.availability.defaultKbdi;
  const fa = input.fuelAvailability ?? fuelAvailabilityAfdrs(input.droughtFactor, p.moistureFamily === 'wetForest', kbdi, p.wrf);
  const flat = vesta2012Ros(u10, p.fhsS, p.fhsNs, 100 * p.hNs, input.deadFuelMoisture, fa, p.wrf);
  const r0 = vesta2012R0(0, p.fhsS, p.fhsNs, 100 * p.hNs, fa, p.wrf) * vesta2012PhiM(input.deadFuelMoisture);
  const theta = input.slopeDeg ?? 0;
  const sf = slopeFactor(theta);
  const rH = Math.min(flat * sf, FIRE_MODEL_PARAMS.forestCapMh);
  const lb = lbForest(u10);
  const e = ellipseCoefficients(lb, createEllipseCoeffs());
  const it = createIntensityOut();
  intensityKernel(p, rH, fa, it);
  return {
    rosHead: rH / 3600, rosBack: Math.min(rH, Math.max(e.cb * flat, r0) * slopeFactor(-theta)) / 3600, rosFlank: (e.h * flat) / 3600,
    lengthBreadth: lb, fuelConsumed: it.w, intensity: it.intensity, flameHeight: it.flameHeight, phase: 0,
    spottingDistance: p.spotting ? spottingEnvelope(rH, u10, p.fhsS) : 0,
    factors: { base: r0 / 3600, wind: r0 > 0 ? flat / r0 : 1, moisture: 1, fuel: 1, slope: sf, terrain: flat * sf > 0 ? rH / (flat * sf) : 1 },
    model: 'Vesta 2012', ros0: r0 / 3600, fuelAvailability: fa, validated: flat * sf <= FIRE_MODEL_PARAMS.forestCapMh,
  };
}

/**
 * McArthur Mk5 comparison model (spec §6.4): FFDI from T/RH/U10/DF, R = 0.0012·FFDI·W km/h with W = `fineFuelLoad`,
 * Z and S from the meter equations; the workbook intensity 516.7·W·(DF/10)·R [K FBCR]; slope via SF (D2).
 */
export function mcArthurMk5Behaviour(input: FireBehaviourInput): FireBehaviourOutput {
  const u10 = 3.6 * input.windSpeed10;
  const f = ffdi(input.temperature, input.relativeHumidity, u10, input.droughtFactor);
  const w = input.fineFuelLoad;
  const r = mk5(f, w);
  const r0 = mk5(ffdi(input.temperature, input.relativeHumidity, 0, input.droughtFactor), w).rosMh;
  const theta = input.slopeDeg ?? 0;
  const sf = slopeFactor(theta);
  const rH = r.rosMh * sf;
  const lb = lbForest(u10);
  const e = ellipseCoefficients(lb, createEllipseCoeffs());
  const wc = w * Math.min(1, input.droughtFactor / 10);
  return {
    rosHead: rH / 3600, rosBack: Math.min(rH, Math.max(e.cb * r.rosMh, 0) * slopeFactor(-theta)) / 3600, rosFlank: (e.h * r.rosMh) / 3600,
    lengthBreadth: lb, fuelConsumed: wc, intensity: BYRAM * wc * rH, flameHeight: r.flameHeight, phase: 0, spottingDistance: 1000 * r.spottingKm,
    factors: { base: r0 / 3600, wind: r0 > 0 ? r.rosMh / r0 : 1, moisture: 1, fuel: 1, slope: sf, terrain: 1 },
    model: 'McArthur Mk5', ros0: r0 / 3600, validated: true,
  };
}

/** Vesta flame height (FBI-TG eq 3.59), re-exported for explain/ (ROS m/h, H_el m). */
export const vestaFlameHeight = flameHeightVesta;

/** Default FireBehaviourInput for a fuel type at its steady state (tests, UI previews). */
export function defaultBehaviourInput(type: FuelType, weather: { u10Ms: number; mPct: number; df: number; tC?: number; rh?: number; curing?: number }): FireBehaviourInput {
  const r = fuelRow(type);
  return {
    fuelType: type, surfaceHazard: r.fhsS, nearSurfaceHazard: r.fhsNs, nearSurfaceHeight: r.hNs, elevatedHazard: r.fhsEl, elevatedHeight: r.hEl,
    barkHazard: 0, fineFuelLoad: r.s + r.ns + r.el, deadFuelMoisture: weather.mPct, windSpeed10: weather.u10Ms, droughtFactor: weather.df,
    curing: weather.curing ?? 100, temperature: weather.tC ?? 30, relativeHumidity: weather.rh ?? 20, canopyCover: r.cover, canopyHeight: r.hO,
    surfaceLoad: r.s, nearSurfaceLoad: r.ns, elevatedLoad: r.el, barkLoad: r.bark, canopyLoad: r.canopy, wrf: r.wrf,
  };
}
