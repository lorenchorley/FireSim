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
import { bootDone, bootStep, diagnosticsText, startBootDiagnostics } from './ui/bootDiagnostics';
import { loadServices } from './ui/modules';
import { initSettings, startThemeSync } from './ui/settings';

async function boot(): Promise<void> {
  startBootDiagnostics();
  const params = new URLSearchParams(location.search);
  const theme = params.get('theme');
  bootStep('settings');
  await initSettings(theme === 'light' || theme === 'dark' ? { theme } : {});
  startThemeSync();
  const root = document.getElementById('app');
  if (!root) throw new Error('#app missing');
  const mock = params.get('mock') === '1' || params.get('mock') === 'true';
  bootStep('modules');
  const services = await loadServices(mock);
  if (mock) console.info('[FireSim] mock mode');
  bootStep('app');
  const app = new App(root, services, params);
  await app.start();
  bootDone();
  document.documentElement.classList.add('booted');
}

const escapeHtml = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

boot().catch((e) => {
  console.error(e);
  bootDone();
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML =
      `<div class="boot-error" role="alert"><h1>FireSim could not start</h1><p>${escapeHtml(String((e as Error).message ?? e))}</p>` +
      `<button type="button" class="btn" onclick="location.reload()">Reload</button>` +
      `<pre class="boot-details">${escapeHtml(diagnosticsText())}</pre></div>`;
  }
});
