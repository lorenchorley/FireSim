/**
 * FireSim entry point.
 *
 * URL parameters (for development, demos and tests):
 *   ?mock=1          use the mock simulation, 2-D map and mock scenario builder
 *   ?theme=light|dark force a theme for this session (not saved)
 *   ?contrast=high   force the high-contrast (bright sun) variant for this session (not saved)
 *   ?notice=1        show the safety notice even if it was accepted
 *   ?debug=1         expose window.__firesim, and honour window.__firesimRemote (stands in for the desktop host in tests)
 * The real modules (src/sim, src/render, src/scenario) are loaded dynamically; if any is missing or fails to load
 * the matching mock is used and a warning is logged (see src/ui/modules.ts).
 */
import { Capacitor } from '@capacitor/core';
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
  await initSettings({
    ...(theme === 'light' || theme === 'dark' ? { theme } : {}),
    ...(params.get('contrast') === 'high' ? { highContrast: true } : {}),
  });
  startThemeSync();
  const root = document.getElementById('app');
  if (!root) throw new Error('#app missing');
  const mock = params.get('mock') === '1' || params.get('mock') === 'true';
  bootStep('modules');
  const services = await loadServices(mock);
  if (mock) console.info('[FireSim] mock mode');
  bootStep('app');
  const app = new App(root, services, params);
  // The desktop engine (0.8.0, workstream J): on the web build only, one lazy chunk reads the pairing code from the address and asks the
  // page's own origin once whether a desktop host serves it. Without a host it does nothing visible; an optional extra never stops the start.
  if (!Capacitor.isNativePlatform() && /^https?:$/.test(location.protocol)) void import('./ui/desktop').then((m) => m.startDesktop(params, services)).catch(() => undefined);
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
