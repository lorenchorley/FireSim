/**
 * What the About block shows about this build, read at build time (never typed in): the app version from package.json
 * (the same number the Android versionName is set from), the build mode, and a build id = the content hash Vite put in the
 * name of the bundle this code shipped in (it changes with every code change), or 'development' on the dev server.
 */
import { version } from '../../package.json';

export const APP_VERSION: string = version;

/** 'production', 'capacitor' (the phone build) or 'development'. */
export const BUILD_MODE: string = import.meta.env.MODE;

/** The content hash in a bundle file name ('…/assets/index-BX3k9aQz.js' -> 'BX3k9aQz'), or null (dev server, tests). */
export function bundleHash(moduleUrl: string): string | null {
  // Vite names chunks '<name>-<8 base64url characters>.js'.
  const m = /\/assets\/[^/?#]*-([A-Za-z0-9_-]{8})\.js(?:[?#].*)?$/.exec(moduleUrl);
  return m ? m[1]! : null;
}

export function buildId(moduleUrl: string = import.meta.url, dev: boolean = import.meta.env.DEV): string {
  return (dev ? null : bundleHash(moduleUrl)) ?? 'development';
}
