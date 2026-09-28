/**
 * Start-up diagnostics: records which boot step is running and every uncaught error / unhandled rejection, and —
 * if the app has not started after {@link BOOT_WATCHDOG_MS} — replaces the endless "Loading FireSim…" splash with
 * the step it is stuck on, the errors seen, and device facts (platform, WebView version, WebGL2, workers), with
 * Reload / Copy buttons. On a phone in the field this is the only debugging information available.
 */
import { Capacitor } from '@capacitor/core';

export const BOOT_WATCHDOG_MS = 15_000;

const errors: string[] = [];
let step = 'starting';
let watchdog: ReturnType<typeof setTimeout> | null = null;
let installed = false;

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function describe(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack.split('\n').slice(1, 4).join('\n')}` : ''}`;
  try {
    return typeof reason === 'string' ? reason : JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

/** Install the error capture and start the watchdog (idempotent). */
export function startBootDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => errors.push(`error: ${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`unhandled rejection: ${describe(e.reason)}`));
  watchdog = setTimeout(showStuck, BOOT_WATCHDOG_MS);
}

/** Record the boot step now running (shown if start-up stalls). */
export function bootStep(name: string): void {
  step = name;
}

/** Start-up finished: stop the watchdog (the error capture stays, for {@link diagnosticsText}). */
export function bootDone(): void {
  step = 'running';
  if (watchdog) clearTimeout(watchdog);
  watchdog = null;
}

function webgl2(): string {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'no';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'yes';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return renderer;
  } catch {
    return 'error';
  }
}

/** Everything useful for a bug report, as plain text. */
export function diagnosticsText(): string {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const lines = [
    `FireSim diagnostics — ${new Date().toISOString()}`,
    `step: ${step}`,
    `platform: ${Capacitor.getPlatform()} (native: ${Capacitor.isNativePlatform()})`,
    `user agent: ${nav?.userAgent ?? '?'}`,
    `module workers: ${typeof Worker !== 'undefined' ? 'yes' : 'no'} · WebGL2: ${webgl2()}`,
    `memory: ${(nav as { deviceMemory?: number } | undefined)?.deviceMemory ?? '?'} GB · cores: ${nav?.hardwareConcurrency ?? '?'}`,
    `url: ${typeof location !== 'undefined' ? location.href : '?'}`,
    `errors (${errors.length}):`,
    ...(errors.length ? errors.map((e) => `  ${e}`) : ['  none']),
  ];
  return lines.join('\n');
}

const STEP_LABELS: Record<string, string> = {
  settings: 'reading your saved settings',
  modules: 'loading the simulation and 3-D modules',
  app: 'opening the first screen',
};

function showStuck(): void {
  watchdog = null;
  const splash = document.querySelector('.boot-splash');
  if (!splash) return;
  const box = document.createElement('div');
  box.className = 'boot-stuck';
  box.setAttribute('role', 'alert');
  box.innerHTML = `
    <p><strong>FireSim is taking longer than expected to start.</strong></p>
    <p>Stuck while ${esc(STEP_LABELS[step] ?? step)}.</p>
    <div class="boot-actions">
      <button type="button" class="btn" data-act="wait">Keep waiting</button>
      <button type="button" class="btn" data-act="reload">Reload</button>
      <button type="button" class="btn" data-act="details">Show details</button>
    </div>
    <pre class="boot-details" hidden></pre>`;
  splash.appendChild(box);
  const pre = box.querySelector('pre')!;
  box.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('button')?.dataset.act;
    if (act === 'reload') location.reload();
    else if (act === 'wait') box.remove();
    else if (act === 'details') {
      pre.hidden = false;
      pre.textContent = diagnosticsText();
      void navigator.clipboard?.writeText(pre.textContent).catch(() => undefined);
    }
  });
}
