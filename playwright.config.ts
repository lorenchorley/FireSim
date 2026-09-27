import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: { executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } }],
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true, timeout: 180_000 },
});
