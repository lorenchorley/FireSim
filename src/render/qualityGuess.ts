/**
 * What the phone says about itself, and the picture quality tier that Auto picks from it. Pure and tiny on purpose: the
 * Settings screen and the Data sets screen read it too, and must not pull the 3-D view's code (Three.js) into the app's
 * first load. {@link guessQuality} is re-exported by SceneView.ts, where the tiers themselves are defined.
 */
import type { RenderQuality } from './SceneView';

/** The two navigator fields the guess reads (both are missing in some browsers; `deviceMemory` is rounded and stops at 8). */
export interface NavigatorFacts {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

/** This phone's cores and memory (GB); null when the browser does not say. */
export interface DeviceFacts {
  cores: number | null;
  memoryGb: number | null;
}

const known = (n: number | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null);

/** The numbers the guess uses, from a navigator (the page's own by default). */
export function deviceFacts(nav: NavigatorFacts = (typeof navigator !== 'undefined' ? navigator : {}) as NavigatorFacts): DeviceFacts {
  return { cores: known(nav.hardwareConcurrency), memoryGb: known(nav.deviceMemory) };
}

/**
 * The tier Auto picks: High at 8 or more cores and 6 GB or more, Low at 4 or fewer cores or 3 GB or less, otherwise Medium.
 * A missing value counts as 4 cores and 4 GB, which gives Low.
 */
export function guessQuality(nav?: NavigatorFacts): RenderQuality {
  const f = deviceFacts(nav);
  const cores = f.cores ?? 4;
  const mem = f.memoryGb ?? 4;
  if (cores >= 8 && mem >= 6) return 'high';
  if (cores <= 4 || mem <= 3) return 'low';
  return 'medium';
}
