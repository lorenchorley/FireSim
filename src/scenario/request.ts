/** What the UI asks the scenario builder for. The builder fetches/derives every layer with fallbacks and progress. */
import type { LatLon, SimOptions, WeatherSeries } from '../core/types';

export type WeatherMode =
  | { kind: 'now' } // current conditions + forecast from now
  | { kind: 'forecast'; start: number } // a future start time (unix ms), from the forecast
  | { kind: 'past'; start: number } // a past date (historical forecast / archive)
  | { kind: 'preset'; presetId: string; start: number }
  | { kind: 'replay'; replayId: string } // bundled historical fire day (e.g. Gospers Mountain 21 Dec 2019)
  | { kind: 'manual'; series: WeatherSeries }; // user-entered / belt weather kit readings

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
}

export interface BuildProgress {
  step: 'terrain' | 'canopy' | 'vegetation' | 'fireHistory' | 'fuel' | 'weather' | 'drought' | 'moisture' | 'done';
  /** 0–1 */
  fraction: number;
  message: string;
  /** Non-fatal problems (e.g. "fire history unavailable offline — assuming 10 years since fire"). */
  warnings: string[];
}
