/**
 * FireSim entry point.
 *
 * URL parameters (for development, demos and tests):
 *   ?mock=1          use the mock simulation, 2-D map and mock scenario builder
 *   ?theme=light|dark force a theme for this session (not saved)
 *   ?notice=1        show the safety notice even if it was accepted
 * The real modules (src/sim, src/render, src/scenario) are loaded dynamically; if any is missing or fails to load
 * the matching mock is used and a warning is logged (see src/ui/modules.ts).
 */
import './styles/main.css';
import { App } from './ui/app';
import { loadServices } from './ui/modules';
import { initSettings, startThemeSync } from './ui/settings';

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme');
  await initSettings(theme === 'light' || theme === 'dark' ? { theme } : {});
  startThemeSync();
  const root = document.getElementById('app');
  if (!root) throw new Error('#app missing');
  const mock = params.get('mock') === '1' || params.get('mock') === 'true';
  const services = await loadServices(mock);
  if (mock) console.info('[FireSim] mock mode');
  const app = new App(root, services, params);
  await app.start();
  document.documentElement.classList.add('booted');
}

boot().catch((e) => {
  console.error(e);
  const root = document.getElementById('app');
  if (root) root.innerHTML = `<div class="boot-error" role="alert"><h1>FireSim could not start</h1><p>${String((e as Error).message ?? e)}</p></div>`;
});
