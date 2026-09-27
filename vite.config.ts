import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Dev-server proxies let the browser build reach data services that do not send CORS headers.
// On device, Capacitor's native HTTP (CapacitorHttp) is used instead, so no proxy is needed there.
const proxy = {
  '/proxy/openmeteo': { target: 'https://api.open-meteo.com', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/openmeteo/, '') },
  '/proxy/openmeteo-archive': { target: 'https://archive-api.open-meteo.com', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/openmeteo-archive/, '') },
  '/proxy/nswenv': { target: 'https://mapprod3.environment.nsw.gov.au', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/nswenv/, '') },
  '/proxy/rfs': { target: 'https://www.rfs.nsw.gov.au', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/rfs/, '') },
};

export default defineConfig({
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: true, port: 5173, proxy },
  preview: { port: 4173, proxy },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2000 },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
});
