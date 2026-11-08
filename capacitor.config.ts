import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell for Android and iOS (see README "Build the phone apps").
 *
 * The web app is built with `npm run build:cap` into `dist/` (relative URLs, `base: './'`, no source maps) and served
 * by Capacitor from https://localhost (Android) / capacitor://localhost (iOS). Everything the app needs offline is in
 * that bundle: the code, the simulation Web Worker (an ES module worker) and the demo sites (public/demo, ~31 MB)
 * and historical replays (public/replays).
 */
const config: CapacitorConfig = {
  appId: 'au.firesim.app',
  appName: 'FireSim',
  webDir: 'dist',
  // Dark splash / status-bar background while the WebView loads (matches the night theme).
  backgroundColor: '#0e1116',
  server: {
    // https (the default since Capacitor 6) gives a secure context for module workers, IndexedDB and geolocation.
    androidScheme: 'https',
  },
  android: {
    // The UI uses CSS container queries, :has() and dvh with fallbacks, and the `inert` attribute: Chrome 105-108. An older
    // System WebView gets Capacitor's "update the WebView" message instead of a half-working screen.
    minWebViewVersion: 108,
    // The desktop link (0.9.0, D36): the page at https://localhost opens a plain ws:// socket to a computer on the local network, and
    // the WebView blocks that as mixed content unless its mode is MIXED_CONTENT_ALWAYS_ALLOW, which this switch sets (it is a
    // boolean; the WebView's compatibility mode does not let a WebSocket through either, and any mode is for the whole WebView, not
    // for one host). The matching cleartext rule is android/app/src/main/res/xml/network_security_config.xml. fetch() of http://
    // does not need this switch: CapacitorHttp below sends it through the native stack. The scheme above must stay https (it is
    // the page's origin and the key of every saved site and run).
    allowMixedContent: true,
  },
  // WebView content debugging (chrome://inspect) follows Capacitor's default: on in debug builds, off in release builds.
  ios: {
    // Let the app draw under the notch; the CSS uses env(safe-area-inset-*).
    contentInset: 'never',
  },
  plugins: {
    // Route fetch() through the native HTTP stack so NSW government / BoM / Open-Meteo services work without CORS.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
