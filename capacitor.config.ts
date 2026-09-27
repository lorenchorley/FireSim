import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'au.firesim.app',
  appName: 'FireSim',
  webDir: 'dist',
  plugins: {
    // Route fetch() through the native HTTP stack so NSW government / BoM / Open-Meteo services work without CORS.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
