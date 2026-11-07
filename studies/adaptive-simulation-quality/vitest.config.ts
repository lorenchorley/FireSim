/**
 * Runner config for the scripts of this study only. The repository's own vite.config.ts includes src/ and tests/; the study
 * scripts import the simulation from ../../src and are run with
 *   npx vitest run --config studies/adaptive-simulation-quality/vitest.config.ts <name>
 * Nothing here is part of the app build, the type-check or `npm test`.
 */
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../../', import.meta.url)),
  test: {
    include: ['studies/adaptive-simulation-quality/scripts/**/*.run.ts'],
    environment: 'node',
    testTimeout: 0,
    hookTimeout: 0,
    fileParallelism: false,
  },
});
