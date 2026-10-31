import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { trimGlsl } from './scripts/glslTrim.ts';

/**
 * Leaves out what the app never uses of the GeoTIFF reader. src/data/canopy.ts reads only the Meta / WRI canopy-height
 * COGs, which are Deflate (docs/research/08-data-sources-apis.md, 3.8). geotiff loads each decoder with import(), so every
 * one is a chunk: LERC and ZSTD are 68 kB gzip together, mostly base64 WebAssembly text. It inflates with pako; fast-png
 * already ships fflate, which does the same job. scripts/check-bundle.mjs fails if a decoder or pako comes back.
 */
function stubUnusedTiffCode(): Plugin {
  const NO_DECODER = '\0firesim-no-tiff-decoder';
  const INFLATE = '\0firesim-inflate-via-fflate';
  return {
    name: 'firesim-stub-unused-tiff-code',
    apply: 'build', // the dev server and vitest keep the real decoders
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !/geotiff[\\/]dist-module[\\/]/.test(importer)) return null;
      if (/compression[\\/]index\.js$/.test(importer) && /^\.\/(lerc|zstd|jpeg|webimage)\.js$/.test(source)) return NO_DECODER;
      return source === 'pako' ? INFLATE : null;
    },
    load(id) {
      if (id === INFLATE) return "import { decompressSync } from 'fflate';\nexport const inflate = (data) => decompressSync(data).slice();\n";
      if (id !== NO_DECODER) return null;
      return "export const zstd = { init: async () => { throw new Error('This build has no decoder for this TIFF compression'); } };\nexport default class UnsupportedTiffDecoder { constructor() { throw new Error('This build has no decoder for this TIFF compression'); } }\n";
    },
  };
}

// Dev-server proxies let the browser build reach data services that do not send CORS headers.
// On device, Capacitor's native HTTP (CapacitorHttp) is used instead, so no proxy is needed there.
const proxy = {
  '/proxy/openmeteo': { target: 'https://api.open-meteo.com', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/openmeteo/, '') },
  '/proxy/openmeteo-archive': { target: 'https://archive-api.open-meteo.com', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/openmeteo-archive/, '') },
  '/proxy/nswenv': { target: 'https://mapprod3.environment.nsw.gov.au', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/nswenv/, '') },
  '/proxy/rfs': { target: 'https://www.rfs.nsw.gov.au', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/rfs/, '') },
  // Meta/WRI canopy-height COGs: the S3 bucket sends no CORS headers (range requests must be proxied in the browser).
  '/proxy/chm': { target: 'https://dataforgood-fb-data.s3.amazonaws.com', changeOrigin: true, rewrite: (p: string) => p.replace(/^\/proxy\/chm/, '') },
};

// `base: './'` keeps every URL relative (assets, the module worker, public/demo and public/replays), so the same
// build works from a web server sub-path, `vite preview` and inside Capacitor (https://localhost / capacitor://localhost).
// `vite build --mode capacitor` (npm run build:cap) leaves out the source maps (~12 MB) from the app bundle.
export default defineConfig(({ mode }) => ({
  plugins: [stubUnusedTiffCode(), ...trimGlsl()],
  base: './',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: true, port: 5173, proxy },
  preview: { port: 4173, proxy },
  // The simulation worker (src/sim/worker.ts) is an ES module worker, bundled with its own chunk.
  worker: { format: 'es' as const },
  build: { target: 'es2022', sourcemap: mode !== 'capacitor', chunkSizeWarningLimit: 2000 },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
  },
}));
