/**
 * The Android app's rules for the desktop link (0.9.0, D36), read from the committed sources: the page at https://localhost
 * opens ws:// and fetches http:// to a computer on the local network. Two switches carry it and both are pinned here, with the
 * things that must NOT change next to them. `scripts/check-android-apk.mjs` reads the same facts back out of a built APK.
 *
 *   - `res/xml/network_security_config.xml` permits cleartext (Android cannot say "private addresses only": a domain-config
 *     matches a name or a domain, never an address range, and the address is typed at run time), trusts only the system's CAs,
 *     and names no host, no user certificate and no debug override;
 *   - the manifest names that file and does not also set `usesCleartextTraffic` (one source of truth);
 *   - `capacitor.config.ts` sets `android.allowMixedContent` (the WebView's mixed-content mode, which blocks ws:// from an https
 *     page), keeps `server.androidScheme` at `https` (the page's origin: changing it loses every saved site and run) and keeps
 *     CapacitorHttp on (it sends fetch of http:// through the native stack, which is why fetch needs no mixed-content switch).
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../../capacitor.config';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const read = (rel: string): string => fs.readFileSync(`${ROOT}${rel}`, 'utf8');
/** The file's text without its XML comments (they talk about the very elements the tests look for). */
const xml = (rel: string): string => read(rel).replace(/<!--[\s\S]*?-->/g, '');

describe('the Android network security config', () => {
  const NSC = 'android/app/src/main/res/xml/network_security_config.xml';

  it('permits cleartext for every host, in the one base-config, and sets nothing else that loosens trust', () => {
    const nsc = xml(NSC);
    expect(nsc.match(/<base-config\b[^>]*>/g)).toEqual(['<base-config cleartextTrafficPermitted="true">']);
    expect(nsc).not.toMatch(/<domain-config\b/); // a host list cannot hold a typed address, and it would only look narrow
    expect(nsc).not.toMatch(/<debug-overrides\b/);
    expect(nsc).not.toMatch(/<pin-set\b/);
  });

  it('trusts the system certificate authorities only (no user or inline certificates)', () => {
    const nsc = xml(NSC);
    expect(nsc.match(/<certificates\b[^>]*>/g)).toEqual(['<certificates src="system" />']);
  });
});

describe('the Android manifest', () => {
  const MANIFEST = 'android/app/src/main/AndroidManifest.xml';

  it('names the network security config and does not also set usesCleartextTraffic', () => {
    const manifest = xml(MANIFEST);
    expect(manifest.match(/android:networkSecurityConfig="[^"]*"/g)).toEqual(['android:networkSecurityConfig="@xml/network_security_config"']);
    // From Android 7.0 a named config replaces the attribute (minSdk is 24), and the attribute is being deprecated: two places to say it would only drift.
    expect(manifest).not.toContain('usesCleartextTraffic');
  });

  it('sits on the application element, so the WebView and the native HTTP stack both follow it', () => {
    const app = xml(MANIFEST).match(/<application\b[^>]*>/)?.[0] ?? '';
    expect(app).toContain('android:networkSecurityConfig="@xml/network_security_config"');
  });

  it('keeps the target SDK below 37, where the local network is open to an app that holds INTERNET', () => {
    // Android 17 blocks the local network by default for an app that targets 37 and asks for the ACCESS_LOCAL_NETWORK permission
    // at run time (developer.android.com/privacy-and-security/local-network-permission); below 37 the INTERNET permission is enough,
    // and the document says not to declare the new permission for a lower target. Raising the target needs that permission, a request
    // for it before the desktop link opens, and a phone check; do that first, then change this number.
    const target = Number(/targetSdkVersion\s*=\s*(\d+)/.exec(read('android/variables.gradle'))?.[1]);
    expect(target).toBeLessThan(37);
    expect(xml(MANIFEST)).toContain('android.permission.INTERNET');
  });
});

describe('the Capacitor config for the Android shell', () => {
  it('lets the WebView open ws:// from the https page: android.allowMixedContent is on', () => {
    expect(config.android?.allowMixedContent).toBe(true);
  });

  it('keeps the page origin: server.androidScheme stays https', () => {
    expect(config.server?.androidScheme).toBe('https');
    expect(config.server?.url).toBeUndefined(); // the app is its own bundle, not a remote page
  });

  it('keeps CapacitorHttp on, which is what sends fetch of http:// through the native stack', () => {
    expect(config.plugins?.CapacitorHttp).toEqual({ enabled: true });
  });
});
