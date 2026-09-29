/** What the UI asks the scenario builder for. The builder fetches/derives every layer with fallbacks and progress. */
import type { LatLon, SimOptions, WeatherSeries } from '../core/types';
import type { BeltKitInput } from './beltKit';

export type WeatherMode =
  | { kind: 'now' } // current conditions + forecast from now
  | { kind: 'forecast'; start: number } // a future start time (unix ms), from the forecast
  | { kind: 'past'; start: number } // a past date (historical forecast / archive)
  | { kind: 'preset'; presetId: string; start: number }
  /** Bundled historical fire day (e.g. Gospers Mountain 19 Dec 2019); `start` defaults to the date at 10:00 LMST. */
  | { kind: 'replay'; replayId: string; start?: number }
  /**
   * User-entered / belt weather kit readings (spec §11.5). `start` defaults to the first reading one hour after the
   * series start (the UI's manualSeries layout); `cloudCover` is the user's cloud chip (default 0 %); `kbdi` is used
   * when the series has none (else KBDI is inferred from the series' drought factor).
   */
  | { kind: 'manual'; series: WeatherSeries; start?: number; cloudCover?: number; kbdi?: number };

export interface ScenarioRequest {
  name?: string;
  centre: LatLon;
  /** Square domain side (m): 3000 – 12000. */
  extent: number;
  /** Use bundled data for this demo site when available (works offline). */
  demoSiteId?: string;
  weather: WeatherMode;
  /** Simulated duration (s). */
  duration: number;
  options?: Partial<SimOptions>;
  /** Allow network requests (false = offline: bundled data, area packs and cache only). */
  online: boolean;
  /**
   * Belt-kit readings taken on the fire ground (spec §11.5), converted by the builder (psychrometer D38 at the site's
   * station pressure, kit wind at ~2 m → 10 m open D39). In a now / forecast run they become a fading domain offset on
   * the forecast T / T_d and a 1 km WindEdit at the reading location; in a manual run they ARE the readings (the
   * manual series then supplies only the drought inputs). Ignored for past, preset and replay runs.
   */
  beltKit?: BeltKitInput[];
  /** Clock override (unix ms) for 'now' and the past/forecast split (tests, replays of a saved session). */
  now?: number;
}

export interface BuildProgress {
  /**
   * 'places' = roads, fire trails, homes, residential zones and place names (scenario/context.ts). It is STARTED first
   * and runs in parallel with the other steps, then collected just before 'done'; a slow live query shows its own
   * message (and fraction 0.90-0.98) here. The UI's step list (ui/labels.ts BUILD_STEPS) needs an entry for it.
   */
  step: 'terrain' | 'canopy' | 'vegetation' | 'fireHistory' | 'fuel' | 'weather' | 'drought' | 'moisture' | 'places' | 'done';
  /** 0–1 */
  fraction: number;
  message: string;
  /** Non-fatal problems (e.g. "fire history unavailable offline — assuming 10 years since fire"). */
  warnings: string[];
}
