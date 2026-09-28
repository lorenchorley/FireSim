import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell for Android and iOS (see README "Build the phone apps").
 *
 * The web app is built with `npm run build:cap` into `dist/` (relative URLs, `base: './'`, no source maps) and served
 * by Capacitor from https://localhost (Android) / capacitor://localhost (iOS). Everything the app needs offline is in
 * that bundle: the code, the simulation Web Worker (an ES module worker) and the demo sites (public/demo, ~29 MB)
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
    // WebView content debugging (chrome://inspect) only in debug builds.
    webContentsDebuggingEnabled: false,
  },
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
